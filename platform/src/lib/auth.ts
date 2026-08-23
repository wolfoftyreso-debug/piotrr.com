import { createHash, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { clientIp, rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { users } from "@/modules/identity/schema";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "@/modules/identity/password";
import { consumeMagicLink } from "@/modules/identity/magic-link";
import {
  createSession,
  resolveSession,
  revokeSession,
  SESSION_COOKIE,
  toActor,
  type SessionUser,
} from "@/modules/identity/session";
import type { Actor } from "@/modules/identity/rbac";

/**
 * Own authentication (Appendix B).
 *
 * Replaces Auth.js. Two sign-in paths — password for staff and returning
 * users, magic link for everyone else — both landing in one server-side
 * session (`modules/identity/session.ts`). Password hashing (scrypt) and
 * magic-link minting already lived in this codebase; what Auth.js
 * contributed was a JWT cookie we could not revoke, so owning the whole
 * path removed a dependency *and* closed a gap.
 *
 * The exported surface is deliberately small: `currentActor`,
 * `currentUser`, `signInWith*`, `signOut`.
 */

const isProduction = env.NODE_ENV === "production";

/**
 * `__Host-` binds the cookie to this exact origin with no Domain
 * attribute, which is what makes subdomain takeover useless against it.
 * It requires Secure, so development over plain HTTP uses the bare name.
 */
export const sessionCookieName = isProduction
  ? `__Host-${SESSION_COOKIE}`
  : SESSION_COOKIE;

function cookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

async function requestContext() {
  const h = await headers();
  return {
    userAgent: h.get("user-agent"),
    // Behind the ingress the client address arrives in a forwarded header.
    // clientIp() reads it from the trusted end, so a session audit row
    // records the address the proxy saw and not one the client invented.
    ip: clientIp(h),
  };
}

async function startSession(userId: string): Promise<void> {
  const { token, expiresAt } = await createSession(userId, await requestContext());
  const jar = await cookies();
  jar.set(sessionCookieName, token, cookieOptions(expiresAt));
}

export type SignInResult = { ok: true } | { ok: false; reason: "invalid" };

/** Email + password. Indistinguishable failures — no account enumeration. */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<SignInResult> {
  const normalised = email.trim().toLowerCase();
  if (!normalised || !password) return { ok: false, reason: "invalid" };

  // Per-address throttle. The caller already limits by client IP, which
  // stops one host hammering the form; this bounds the other shape —
  // many hosts guessing at one account. Counted before the password is
  // checked, so the attempt itself is what costs, and reset on success.
  const attempts = rateLimit(`signin-account:${normalised}`, {
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!attempts.allowed) return { ok: false, reason: "invalid" };

  const user = await db.query.users.findFirst({
    where: eq(users.email, normalised),
  });
  if (
    !user ||
    !user.active ||
    user.deletedAt ||
    !user.passwordHash ||
    // A password only signs in once the mailbox is proven. Self-registration
    // sets a password on an unverified account; treating that as "invalid"
    // (with the same dummy hash and generic reason) means a squatter's
    // password never grants access, and the account's verification state does
    // not leak through timing or the error.
    !user.emailVerifiedAt
  ) {
    // Still hash something so a missing account is not measurably faster.
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return { ok: false, reason: "invalid" };
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    return { ok: false, reason: "invalid" };
  }

  // The one moment the plaintext exists and is known correct: upgrade a
  // hash written under weaker scrypt parameters. Best effort — a failed
  // rewrite must never cost the user their sign-in.
  if (needsRehash(user.passwordHash)) {
    try {
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(password) })
        .where(eq(users.id, user.id));
    } catch {
      /* logged by the driver; the session below is what matters */
    }
  }

  // A correct password clears the counter: a legitimate user who mistyped
  // a few times is not locked out behind their own success.
  resetRateLimit(`signin-account:${normalised}`);
  await startSession(user.id);
  return { ok: true };
}

/** Single-use email link. The token is verified and burned in one step. */
export async function signInWithMagicLink(
  email: string,
  token: string,
): Promise<SignInResult> {
  if (!email || !token) return { ok: false, reason: "invalid" };

  const userId = await consumeMagicLink(email, token);
  if (!userId) return { ok: false, reason: "invalid" };

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || !user.active || user.deletedAt) {
    return { ok: false, reason: "invalid" };
  }

  await startSession(user.id);
  return { ok: true };
}

/** Sign in immediately after self-registration. */
export async function startSessionForUser(userId: string): Promise<void> {
  await startSession(userId);
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  await revokeSession(jar.get(sessionCookieName)?.value);
  jar.delete(sessionCookieName);
}

/** The signed-in user for this request, or null. */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return resolveSession(jar.get(sessionCookieName)?.value);
}

/** Resolve the RBAC actor for the current request (null if signed out). */
export async function currentActor(): Promise<Actor | null> {
  const user = await currentUser();
  return user ? toActor(user) : null;
}

/**
 * Constant-time equality for bearer secrets (METRICS_TOKEN, CRON_SECRET).
 *
 * `presented !== expected` short-circuits at the first differing byte,
 * which turns response timing into an oracle over the secret's prefix.
 * The identity module already compares everything through
 * `timingSafeEqual`; these two endpoints were the stragglers. Both sides
 * are hashed first so inputs of different lengths compare in the same
 * time as equal-length ones, without leaking which case it was.
 */
export function secretEquals(presented: string | undefined | null, expected: string): boolean {
  if (!presented) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
