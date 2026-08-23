import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/modules/identity/schema";

/** Messaging (M3): one thread per RFQ–supplier pair */
export const messageThreads = pgTable("message_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  rfqId: uuid("rfq_id").notNull(),
  companyId: uuid("company_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const threadMessages = pgTable("thread_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => messageThreads.id),
  senderUserId: uuid("sender_user_id")
    .notNull()
    .references(() => users.id),
  body: text("body").notNull(),
  attachmentObjectKey: text("attachment_object_key"),
  attachmentFileName: text("attachment_file_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
},
  (t) => [index("idx_thread_messages_thread_created").on(t.threadId, t.createdAt)],
);
