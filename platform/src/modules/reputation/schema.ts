import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "@/modules/companies/schema";
import { users } from "@/modules/identity/schema";

export const reviewStatus = pgEnum("review_status", [
  "pending",
  "published",
  "rejected",
]);

/**
 * A buyer's rating of a completed job.
 *
 * `deal_id` is UNIQUE — one review per deal, enforced by the database and
 * not only by the service. That single constraint is what keeps this from
 * becoming a review farm: a rating cannot exist without a deal that ops
 * recorded, and a deal cannot be rated twice.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealId: uuid("deal_id").notNull().unique(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    /** PII-adjacent: identifies the buyer who wrote it. */
    buyerUserId: uuid("buyer_user_id")
      .notNull()
      .references(() => users.id),

    workmanship: integer("workmanship").notNull(),
    schedule: integer("schedule").notNull(),
    communication: integer("communication").notNull(),
    documentation: integer("documentation").notNull(),

    comment: text("comment"),
    status: reviewStatus("status").notNull().default("pending"),
    /** Set when ops publishes. Null means it is not public yet. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    moderatedBy: uuid("moderated_by").references(() => users.id),
    moderationNote: text("moderation_note"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_reviews_buyer").on(t.buyerUserId),index("reviews_company_idx").on(t.companyId)],
);
