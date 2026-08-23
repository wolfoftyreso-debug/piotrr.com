import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { appendOutbox, writeAudit } from "@/modules/audit/service";
import { companies } from "@/modules/companies/schema";
import { deals } from "@/modules/offers/schema";
import { requireAnyRole, ForbiddenError, type Actor } from "@/modules/identity/rbac";
import { reviews } from "./schema";
import {
  aggregate,
  assertValidScores,
  merits,
  meritsBySource,
  RATING_DIMENSIONS,
  type Aggregate,
  type Merit,
  type MeritSource,
  type RatingScores,
} from "./domain";

export type Review = typeof reviews.$inferSelect;

export interface CompanyReputation {
  rating: Aggregate;
  merits: Record<MeritSource, Merit[]>;
  published: Review[];
}

function scoresOf(row: Review): RatingScores {
  return {
    workmanship: row.workmanship,
    schedule: row.schedule,
    communication: row.communication,
    documentation: row.documentation,
  };
}

/**
 * Leave a rating for a deal.
 *
 * Only the buyer named on the deal may do it, and only once — the unique
 * constraint on `deal_id` is the real guard; this check exists to return a
 * sentence instead of a constraint violation.
 */
export async function submitReview(
  actor: Actor,
  input: {
    dealId: string;
    scores: Partial<RatingScores>;
    comment?: string;
  },
): Promise<Review> {
  const scores = assertValidScores(input.scores);

  const deal = await db.query.deals.findFirst({
    where: eq(deals.id, input.dealId),
  });
  if (!deal) throw new Error("No such deal");

  // A rating belongs to the buyer who bought the work. Ops cannot write one
  // on their behalf — that would make the whole signal worthless.
  if (deal.buyerUserId !== actor.userId) {
    throw new ForbiddenError("Only the buyer on this deal can review it");
  }

  const existing = await db.query.reviews.findFirst({
    where: eq(reviews.dealId, input.dealId),
  });
  if (existing) throw new Error("This deal has already been reviewed");

  const comment = input.comment?.trim().slice(0, 2000) || null;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(reviews)
      .values({
        dealId: deal.id,
        companyId: deal.companyId,
        buyerUserId: actor.userId,
        workmanship: scores.workmanship,
        schedule: scores.schedule,
        communication: scores.communication,
        documentation: scores.documentation,
        comment,
      })
      .returning();
    if (!row) throw new Error("Review insert failed");

    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "review",
      entityId: row.id,
      action: "review.submitted",
      after: { dealId: deal.id, companyId: deal.companyId, ...scores },
    });
    await appendOutbox(tx, "reputation.review_submitted", {
      reviewId: row.id,
      companyId: deal.companyId,
    });
    return row;
  });
}

/**
 * Ops moderation. A rating goes public only after a human has read it —
 * the same gate the portfolio images already pass through, and the reason
 * a supplier can dispute a review instead of being defamed by it.
 */
export async function moderateReview(
  actor: Actor,
  reviewId: string,
  decision: "published" | "rejected",
  note?: string,
): Promise<Review> {
  requireAnyRole(actor, ["ops", "admin"]);

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(reviews)
      .where(eq(reviews.id, reviewId))
      .for("update");
    if (!before) throw new Error("No such review");

    const [row] = await tx
      .update(reviews)
      .set({
        status: decision,
        publishedAt: decision === "published" ? new Date() : null,
        moderatedBy: actor.userId,
        moderationNote: note?.slice(0, 1000) ?? null,
        updatedAt: new Date(),
      })
      .where(eq(reviews.id, reviewId))
      .returning();
    if (!row) throw new Error("Review update failed");

    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "review",
      entityId: reviewId,
      action: `review.${decision}`,
      before: { status: before.status },
      after: { status: decision, note: note ?? null },
    });
    return row;
  });
}

export async function listPendingReviews(actor: Actor): Promise<Review[]> {
  requireAnyRole(actor, ["ops", "admin"]);
  return db
    .select()
    .from(reviews)
    .where(and(eq(reviews.status, "pending"), isNull(reviews.deletedAt)))
    .orderBy(desc(reviews.createdAt));
}

/** Everything the public profile needs, in one call. */
export async function companyReputation(
  companyId: string,
  now = new Date(),
): Promise<CompanyReputation> {
  const [company] = await db
    .select({
      yearFounded: companies.yearFounded,
      certifications: companies.certifications,
      awards: companies.awards,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  const rows = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.companyId, companyId), isNull(reviews.deletedAt)))
    .orderBy(desc(reviews.publishedAt));

  const [{ count: dealCount } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(deals)
    .where(eq(deals.companyId, companyId));

  const { checkedReferences } = await countCheckedReferences(companyId);

  const list = merits({
    yearFounded: company?.yearFounded ?? null,
    certifications: company?.certifications ?? [],
    awards: company?.awards ?? [],
    completedDeals: dealCount,
    checkedReferences,
    now,
  });

  return {
    rating: aggregate(rows.map((r) => ({ scores: scoresOf(r), publishedAt: r.publishedAt }))),
    merits: meritsBySource(list),
    published: rows.filter((r) => r.publishedAt !== null),
  };
}

/**
 * Reference projects ops collected. Owned by the companies module, so it
 * is read through its service rather than by touching its table.
 */
async function countCheckedReferences(
  companyId: string,
): Promise<{ checkedReferences: number }> {
  const { listReferences } = await import("@/modules/companies/service");
  try {
    const refs = await listReferences(companyId);
    return { checkedReferences: refs.length };
  } catch {
    return { checkedReferences: 0 };
  }
}

export { RATING_DIMENSIONS };
