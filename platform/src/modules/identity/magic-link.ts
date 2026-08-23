import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { counter } from "@/lib/metrics";
import { emailProvider } from "@/modules/notifications/email";
import { sessions, users, verificationTokens } from "./schema";

/**
 * Email magic-link sign-in (Section 3), on top of the existing
 * EmailProvider interface — so it works with SES, an own SMTP relay, or
 * the console adapter in development.
 *
 * Only a SHA-256 hash of the token is stored: a leaked database dump must
 * not hand out working sign-in links.
 */

const TOKEN_TTL_MINUTES = 15;

const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export interface MagicLinkResult {
  /** Present only when no mail is sent (console provider in development). */
  devUrl?: string;
}

/**
 * Issue a one-time sign-in link. Always resolves the same way whether or
 * not the address exists, so the endpoint cannot be used to enumerate
 * accounts.
 */
export async function requestMagicLink(
  email: string,
  baseUrl: string,
  locale = "sv",
): Promise<MagicLinkResult> {
  const identifier = email.trim().toLowerCase();
  const user = await db.query.users.findFirst({
    where: eq(users.email, identifier),
  });

  if (!user || !user.active || user.deletedAt) {
    logger.info({ identifier }, "magic link requested for unknown account");
    return {};
  }

  // One live link per address: issuing a new one invalidates the previous.
  await db
    .delete(verificationTokens)
    .where(eq(verificationTokens.identifier, identifier));

  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);
  await db.insert(verificationTokens).values({
    identifier,
    token: hash(token),
    expires,
  });

  const url = `${baseUrl}/${locale}/signin/link?token=${token}&email=${encodeURIComponent(identifier)}`;
  const provider = emailProvider();
  try {
    await provider.send({
      to: identifier,
      subject: "Din inloggningslänk till Piotrr",
      text:
        `Klicka för att logga in — länken gäller i ${TOKEN_TTL_MINUTES} minuter ` +
        `och kan bara användas en gång:\n\n${url}\n\n` +
        "Om du inte bad om den här länken kan du ignorera mejlet.",
    });
  } catch (error) {
    /**
     * A failing mail relay must not turn this endpoint into the oracle the
     * comment above promises it is not. Measured with nothing listening on
     * the SMTP port: an unknown address resolved in 2 ms, a known one threw
     * `ECONNREFUSED` — a perfect yes/no on whether an account exists, and a
     * crashed form for the legitimate user at the same time.
     *
     * So a send failure is logged and counted, never propagated. The token
     * stays valid: the user retries once mail is back, and nothing has to
     * be re-issued.
     *
     * Residual, and deliberately not papered over: a known address still
     * does more work than an unknown one, so a timing difference remains.
     * Closing that means queueing the send for both, which is worth doing
     * when there is a reason to think anyone is measuring.
     */
    logger.error({ err: error, identifier }, "magic link email could not be sent");
    counter(
      "magic_link_send_failures_total",
      "Sign-in link emails the relay refused. Every one is a user who asked to sign in and got nothing.",
    );
  }

  // The console provider only logs; surface the link so local sign-in
  // works. Decided from the same boot-parsed env the provider itself is
  // chosen from — the raw process.env read this used to do disagreed with
  // emailProvider() whenever the variable changed after start.
  return env.EMAIL_PROVIDER === "console" ? { devUrl: url } : {};
}

/**
 * Redeem a link. Returns the user id on success, null on any failure —
 * unknown, expired, already used or mismatched token all look identical.
 */
export async function consumeMagicLink(
  email: string,
  token: string,
): Promise<string | null> {
  const identifier = email.trim().toLowerCase();
  const candidate = hash(token);

  /**
   * The whole redemption is ONE transaction. Three properties depend on it:
   *
   *  - Atomic single use: `DELETE … RETURNING` hands the row to exactly one
   *    caller, so two concurrent redemptions cannot both sign in (an earlier
   *    read-then-delete could).
   *  - No token burn on a lost race: the DELETE lives inside the same
   *    transaction as the verify writes, so if that transaction rolls back
   *    for any reason the token is restored and the user can retry. (An
   *    earlier version deleted the token in its own auto-committed statement;
   *    a deadlock on the later writes then destroyed a live link while the
   *    proof failed.)
   *  - No token burn from a wrong secret: matching the hash in the WHERE
   *    means a *wrong* token deletes nothing, so an attacker who knows only
   *    the email cannot invalidate the owner's live link. Deleting on
   *    identifier alone (an even earlier version) was an unauthenticated
   *    lockout of password-less accounts.
   *
   * The match is a lookup by a 256-bit hash, not a secret compared in code,
   * so there is nothing to time.
   *
   * Lock ordering: the first-proof branch locks the session rows BEFORE the
   * user row, the same order `setPassword` takes (it locks its session row
   * FOR UPDATE, then updates the user). Consistent ordering means a squatter
   * racing `setPassword` against this proof can never deadlock — one waits
   * for the other on the shared session row — so mailbox proof always wins
   * cleanly instead of one side dying as a deadlock victim.
   */
  return db.transaction(async (tx) => {
    const [row] = await tx
      .delete(verificationTokens)
      .where(
        and(
          eq(verificationTokens.identifier, identifier),
          eq(verificationTokens.token, candidate),
        ),
      )
      .returning();
    if (!row) return null;
    if (row.expires.getTime() < Date.now()) return null;

    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.email, identifier))
      .limit(1);
    if (!user || !user.active || user.deletedAt) return null;

    // Following a link proves control of the mailbox — for the FIRST time
    // here. A self-registration can occupy an unused email, set a password
    // and open a live session before anyone proves they own the address.
    // Neither survives that first proof: revoke every existing session and
    // clear the password, so proving ownership takes exclusive control. The
    // verified owner starts fresh (the caller opens a new session immediately
    // after) and can set their own password afterwards (setPassword).
    // Password sign-in already requires a verified email, so a squatter's
    // password was never usable to sign in and is now gone.
    if (!user.emailVerifiedAt) {
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));
      await tx
        .update(users)
        .set({ emailVerifiedAt: new Date(), passwordHash: null })
        .where(eq(users.id, user.id));
    }
    return user.id;
  });
}

/** Housekeeping for tokens nobody redeemed. */
export async function purgeExpiredTokens(now: Date = new Date()): Promise<number> {
  const deleted = await db
    .delete(verificationTokens)
    .where(lt(verificationTokens.expires, now))
    .returning({ token: verificationTokens.token });
  return deleted.length;
}

export const MAGIC_LINK_TTL_MINUTES = TOKEN_TTL_MINUTES;
