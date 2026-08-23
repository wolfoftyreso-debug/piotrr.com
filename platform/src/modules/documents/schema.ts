import {
  bigint,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/modules/identity/schema";

export const malwareScanStatus = pgEnum("malware_scan_status", [
  "pending",
  "clean",
  "infected",
  "error",
]);

/**
 * Documents module: verification evidence lives in the versioned private
 * `documents` bucket; rows reference the object key + checksum (Section 6).
 */
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  workerId: uuid("worker_id"),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  objectKey: text("object_key").notNull().unique(),
  checksumSha256: text("checksum_sha256"),
  uploadedBy: uuid("uploaded_by")
    .notNull()
    .references(() => users.id),
  /** GuardDuty Malware Protection hook; stub keeps status 'pending' -> 'clean' in dev */
  scanStatus: malwareScanStatus("scan_status").notNull().default("pending"),
  /** Retention policy is configurable per document type (GDPR §4.6) */
  documentType: text("document_type"),
  retainUntil: timestamp("retain_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
