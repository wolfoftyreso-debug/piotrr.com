import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/modules/audit/service";
import { users } from "./schema";
import { companies, contacts, workers } from "@/modules/companies/schema";
import { rfqs } from "@/modules/rfq/schema";
import { offers } from "@/modules/offers/schema";
import { threadMessages } from "@/modules/messaging/schema";
import { requireAnyRole, ForbiddenError, type Actor } from "./rbac";

/**
 * GDPR obligations (Section 4.6): a per-user data export and a scheduled
 * purge of soft-deleted personal data.
 *
 * The audit trail is deliberately NOT purged — it records who decided what
 * and when, which is a legal record of the verification decisions rather
 * than profile data, and Section 8.5 forbids weakening it.
 */

export interface UserDataExport {
  exportedAt: string;
  subject: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    createdAt: string;
    deletedAt: string | null;
  };
  company: unknown;
  contacts: unknown[];
  workers: unknown[];
  rfqs: unknown[];
  offers: unknown[];
  messages: unknown[];
}

/**
 * Everything the platform holds about one person, as JSON.
 * A user may export themselves; ops/admin may export on their behalf
 * (subject-access requests arrive by email, not through the account).
 */
export async function exportUserData(
  actor: Actor,
  userId: string,
): Promise<UserDataExport> {
  if (actor.userId !== userId) {
    requireAnyRole(actor, ["ops", "admin"]);
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error("No such user");

  const ownedCompany = await db.query.companies.findFirst({
    where: eq(companies.ownerUserId, userId),
  });

  const [companyContacts, companyWorkers, buyerRfqs, submittedOffers, sentMessages] =
    await Promise.all([
      ownedCompany
        ? db.select().from(contacts).where(eq(contacts.companyId, ownedCompany.id))
        : Promise.resolve([]),
      ownedCompany
        ? db.select().from(workers).where(eq(workers.companyId, ownedCompany.id))
        : Promise.resolve([]),
      db.select().from(rfqs).where(eq(rfqs.buyerUserId, userId)),
      db.select().from(offers).where(eq(offers.submittedBy, userId)),
      db.select().from(threadMessages).where(eq(threadMessages.senderUserId, userId)),
    ]);

  return {
    exportedAt: new Date().toISOString(),
    subject: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
      deletedAt: user.deletedAt?.toISOString() ?? null,
    },
    company: ownedCompany ?? null,
    contacts: companyContacts,
    workers: companyWorkers,
    rfqs: buyerRfqs,
    offers: submittedOffers,
    messages: sentMessages,
  };
}

/** Soft-delete a user; the purge job anonymises them after the grace period. */
export async function requestErasure(
  actor: Actor,
  userId: string,
): Promise<void> {
  if (actor.userId !== userId) {
    requireAnyRole(actor, ["ops", "admin"]);
  }
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error("No such user");
  if (user.role === "admin" && actor.userId === userId) {
    throw new ForbiddenError("An admin cannot erase their own account");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, userId));
    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "user",
      entityId: userId,
      action: "user.erasure_requested",
      after: { gracePeriodDays: PURGE_GRACE_DAYS },
    });
  });

  // An erasure request must not leave a signed-in browser behind.
  const { revokeAllSessionsForUser } = await import("./session");
  await revokeAllSessionsForUser(userId);
}

/** Days a soft-deleted account is retained before its PII is overwritten. */
export const PURGE_GRACE_DAYS = 30;

/**
 * Overwrite personal fields on accounts soft-deleted longer ago than the
 * grace period. Rows are kept (foreign keys from offers, deals and the
 * audit trail must stay intact) but no longer identify a person.
 */
export async function purgeExpiredUsers(
  now: Date = new Date(),
  graceDays: number = PURGE_GRACE_DAYS,
): Promise<{ purged: number }> {
  const cutoff = new Date(now.getTime() - graceDays * 24 * 3600 * 1000);

  const due = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        isNotNull(users.deletedAt),
        lt(users.deletedAt, cutoff),
        sql`${users.email} NOT LIKE 'purged+%'`,
      ),
    );

  for (const row of due) {
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          email: `purged+${row.id}@invalid.local`,
          name: null,
          passwordHash: null,
          emailVerifiedAt: null,
        })
        .where(eq(users.id, row.id));
      await writeAudit(tx, {
        actorId: row.id,
        entityType: "user",
        entityId: row.id,
        action: "user.pii_purged",
        after: { graceDays },
      });
    });
  }

  if (due.length > 0) {
    logger.info({ purged: due.length }, "GDPR purge completed");
  }
  return { purged: due.length };
}
