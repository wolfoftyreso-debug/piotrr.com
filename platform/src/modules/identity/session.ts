import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sessions, users } from "./schema";
import type { Actor, Role } from "./rbac";

/**
 * Own session layer (Appendix B: no managed auth service, and no auth
 * framework either — the surface we needed was small enough to own).
 *
 * Design:
 *  - The cookie holds an opaque 256-bit random token. It is never a JWT:
 *    a signed token cannot be revoked, and suspending an ops account has
 *    to take effect on the next request, not on the next expiry.
 *  - Only SHA-256(token) is stored. A database leak yields digests, not
 *    live sessions.
 *  - Every lookup re-reads the user, so `active`, `deletedAt` and a role
 *    change all take effect immediately.
 */

export const SESSION_COOKIE = "bb_session";
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days
/** Only touch last_seen_at when it is this stale — one write per hour, not per request. */
const TOUCH_AFTER_MS = 60 * 60 * 1000;
/** Cap live sessions per account so the table cannot grow without bound. */
const MAX_LIVE_SESSIONS = 20;

export interface SessionUser {
  userId: string;
  role: Role;
  email: string;
  name: string | null;
  sessionId: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Hash an IP for abuse triage without storing the address itself (GDPR §4.6). */
function hashIp(ip: string | null): string | null {
  return ip ? sha256(`${env.AUTH_SECRET}:${ip}`).slice(0, 32) : null;
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

/** Mint a session for an already-authenticated user. */
export async function createSession(
  userId: string,
  context: { userAgent?: string | null; ip?: string | null } = {},
): Promise<IssuedSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    expiresAt,
    userAgent: context.userAgent?.slice(0, 300) ?? null,
    ipHash: hashIp(context.ip ?? null),
  });

  await trimSessions(userId);
  return { token, expiresAt };
}

/**
 * Keep only the newest MAX_LIVE_SESSIONS per account. Without this an
 * account that signs in from a script accumulates rows forever, and every
 * stale row is a credential that still works.
 */
async function trimSessions(userId: string): Promise<void> {
  const live = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .orderBy(desc(sessions.createdAt));

  const excess = live.slice(MAX_LIVE_SESSIONS);
  if (excess.length === 0) return;

  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      inArray(
        sessions.id,
        excess.map((s) => s.id),
      ),
    );
}

/**
 * Resolve a cookie token to the acting user, or null.
 *
 * Returns null — never throws — for every failure mode: unknown token,
 * expired, revoked, deleted user, suspended user.
 */
export async function resolveSession(
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;

  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      role: users.role,
      email: users.email,
      name: users.name,
      active: users.active,
      deletedAt: users.deletedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, sha256(token)))
    .limit(1);

  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  // A suspended or erased account loses every live session at once.
  if (!row.active || row.deletedAt) return null;

  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, row.sessionId));
  }

  return {
    userId: row.userId,
    role: row.role as Role,
    email: row.email,
    name: row.name,
    sessionId: row.sessionId,
  };
}

/** Sign out one session. */
export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, sha256(token)));
}

/** Sign out everywhere — used on password change and on suspension. */
export async function revokeAllSessionsForUser(userId: string): Promise<number> {
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return revoked.length;
}

/** Nightly cleanup: rows that can never authenticate again. */
export async function purgeDeadSessions(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const deleted = await db
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, now), lt(sessions.revokedAt, cutoff)))
    .returning({ id: sessions.id });
  return deleted.length;
}

export function toActor(user: SessionUser): Actor {
  return { userId: user.userId, role: user.role };
}

/**
 * Constant-time compare for tokens handed to us in a header (API keys).
 * Exported here so both auth paths share one implementation.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export { sha256 as hashToken };
