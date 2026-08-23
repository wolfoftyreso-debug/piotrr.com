import {
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/modules/identity/schema";

/**
 * Verification module — the moat.
 * Binary verification only: a company is Verified for a corridor or it is
 * not. No tiers, no scores, no paid visibility (Section 5/M1).
 */

export const verificationCaseState = pgEnum("verification_case_state", [
  "draft",
  "in_review",
  "verified",
  "suspended",
  "expired",
]);

export const verificationItemStatus = pgEnum("verification_item_status", [
  "missing",
  "submitted",
  "in_review",
  "approved",
  "rejected",
  "expired",
]);

export const verificationCases = pgTable("verification_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  corridorId: uuid("corridor_id").notNull(),
  state: verificationCaseState("state").notNull().default("draft"),
  stateChangedAt: timestamp("state_changed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  assignedOpsUserId: uuid("assigned_ops_user_id").references(() => users.id),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verificationItems = pgTable("verification_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull(),
  requirementDefinitionId: uuid("requirement_definition_id").notNull(),
  /** Set when the requirement scope is worker/assignment */
  workerId: uuid("worker_id"),
  assignmentRef: text("assignment_ref"),
  status: verificationItemStatus("status").notNull().default("missing"),
  /** e.g. approval date, insurer, coverage amount, cert process — per metadataSpec */
  metadata: jsonb("metadata").notNull().default({}),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  documentIds: uuid("document_ids").array().notNull().default([]),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  decisionNote: text("decision_note"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const opsTaskStatus = pgEnum("ops_task_status", [
  "open",
  "in_progress",
  "done",
  "dismissed",
]);

export const opsTasks = pgTable("ops_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  detail: text("detail"),
  companyId: uuid("company_id"),
  caseId: uuid("case_id"),
  itemId: uuid("item_id"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  status: opsTaskStatus("status").notNull().default("open"),
  assignedTo: uuid("assigned_to").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
