import { createHash } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { appendOutbox, writeAudit } from "@/modules/audit/service";
import { sessions, users } from "./schema";
import { hashPassword } from "./password";
import { ForbiddenError, requireAnyRole, type Actor, type Role } from "./rbac";

export type User = typeof users.$inferSelect;

export const registerInputSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(200),
  name: z.string().min(1).max(120),
  /** Self-serve signup only creates marketplace roles — never admin/ops */
  role: z.enum(["buyer", "supplier"]),
});

export type RegisterInput = z.infer<typeof registerInputSchema>;

export class EmailTakenError extends Error {
  constructor() {
    super("An account with this email already exists");
    this.name = "EmailTakenError";
  }
}

/**
 * Self-serve registration (Alibaba model): customers sign up as `buyer`,
 * companies sign up as `supplier` and then create their company profile.
 * admin/ops accounts are provisioned internally, never via this path.
 */
export async function registerUser(input: RegisterInput): Promise<User> {
  const parsed = registerInputSchema.parse(input);
  const email = parsed.email.toLowerCase();

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (existing) throw new EmailTakenError();

  const passwordHash = await hashPassword(parsed.password);

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email,
        name: parsed.name,
        role: parsed.role as Role,
        passwordHash,
        // Password signup: e-mail ownership is confirmed via the magic-link
        // flow when EMAIL_PROVIDER=ses; console provider logs the link in dev.
        emailVerifiedAt: null,
      })
      .returning();
    if (!user) throw new Error("User insert failed");

    await writeAudit(tx, {
      actorId: user.id,
      entityType: "user",
      entityId: user.id,
      action: "user.registered",
      after: { role: parsed.role },
    });
    await appendOutbox(tx, "identity.user_registered", {
      userId: user.id,
      role: parsed.role,
    });
    return user;
  });
}

export async function getUserById(id: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

const passwordSchema = z.string().min(10).max(200);

/**
 * Set (or replace) the signed-in user's own password, identified by the live
 * session token rather than a pre-resolved actor.
 *
 * This is the recovery path after the first magic-link verification clears a
 * password set before the mailbox was proven. It is written to lose a race
 * against that proof: the session row is locked FOR UPDATE and re-checked for
 * revocation inside the same transaction as the password write. A mailbox
 * proof clears the password and revokes sessions in its own transaction, so
 * whichever transaction reaches the shared session row first serialises the
 * other — a revoked session can never restore a password on the account it
 * just lost.
 */
export async function setPassword(sessionToken: string, newPassword: string): Promise<void> {
  const password = passwordSchema.parse(newPassword);
  const passwordHash = await hashPassword(password); // slow work, before the lock
  const tokenHash = createHash("sha256").update(sessionToken).digest("hex");

  await db.transaction(async (tx) => {
    const [session] = await tx
      .select({
        userId: sessions.userId,
        revokedAt: sessions.revokedAt,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .for("update");
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new ForbiddenError("Your session is no longer valid");
    }
    const [before] = await tx
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    if (!before || !before.active || before.deletedAt) {
      throw new ForbiddenError("No such account");
    }
    await tx
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, session.userId));
    await writeAudit(tx, {
      actorId: session.userId,
      entityType: "user",
      entityId: session.userId,
      action: "user.password_set",
      after: { hadPassword: before.passwordHash !== null },
    });
  });
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  return db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });
}

/**
 * Provision an internal account (Section 5/M1: the concierge ops team).
 * Self-serve registration can only create buyer/supplier accounts, so
 * ops and admin users are minted here by an existing admin. The account
 * starts without a password — the new colleague signs in with an email
 * magic link and can then set one.
 */
export async function provisionStaffUser(
  actor: Actor,
  input: { email: string; name: string; role: "ops" | "admin" },
): Promise<User> {
  requireAnyRole(actor, ["admin"]);
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Enter a valid email address");
  }
  if (input.name.trim().length < 2) throw new Error("Name is too short");
  if (!["ops", "admin"].includes(input.role)) {
    throw new Error("Staff accounts must be ops or admin");
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (existing) throw new EmailTakenError();

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email,
        name: input.name.trim(),
        role: input.role,
        passwordHash: null,
        emailVerifiedAt: null,
      })
      .returning();
    if (!user) throw new Error("Staff user insert failed");

    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "user",
      entityId: user.id,
      action: "user.staff_provisioned",
      after: { role: input.role, email },
    });
    return user;
  });
}

/** Suspend or restore an internal account (admin only). */
export async function setUserActive(
  actor: Actor,
  userId: string,
  active: boolean,
): Promise<void> {
  requireAnyRole(actor, ["admin"]);
  if (actor.userId === userId && !active) {
    throw new Error("You cannot deactivate your own account");
  }
  await db.transaction(async (tx) => {
    await tx.update(users).set({ active }).where(eq(users.id, userId));
    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "user",
      entityId: userId,
      action: active ? "user.reactivated" : "user.deactivated",
      after: { active },
    });
  });

  // Suspension has to bite now, not at the next session expiry.
  if (!active) {
    const { revokeAllSessionsForUser } = await import("./session");
    const revoked = await revokeAllSessionsForUser(userId);
    if (revoked > 0) {
      logger.info({ userId, revoked }, "sessions revoked on suspension");
    }
  }
}

/** Internal accounts for the admin console. */
export async function listStaffUsers(actor: Actor): Promise<User[]> {
  requireAnyRole(actor, ["ops", "admin"]);
  return db
    .select()
    .from(users)
    .where(inArray(users.role, ["ops", "admin"]))
    .orderBy(asc(users.email));
}
