import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Audit module. Every mutation writes audit_events; verification decisions
 * and offer submissions are legally sensitive (Section 4.4). Never weaken
 * or bypass these writes.
 */
export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id"),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  action: text("action").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  requestId: text("request_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Outbox pattern, monolith-style (Section 4.3): state changes append here in
 * the same transaction; the pg-boss dispatcher fans out in-process.
 */
export const outboxEvents = pgTable("outbox_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

/** Idempotency keys for POST endpoints (Section 4.5) */
export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  requestHash: text("request_hash").notNull(),
  responseBody: jsonb("response_body"),
  statusCode: text("status_code"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
