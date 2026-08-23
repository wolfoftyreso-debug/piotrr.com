import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  type: text("type").notNull(),
  subject: text("subject").notNull(),
  body: text("body"),
  link: text("link"),
  /** Delivery channel record: 'email' | 'in_app' */
  channel: text("channel").notNull().default("in_app"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
