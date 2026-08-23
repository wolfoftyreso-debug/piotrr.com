import { auditEvents, outboxEvents } from "./schema";
import type { Tx } from "@/lib/db";

export interface AuditEntry {
  actorId: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
}

/**
 * Write an audit event inside the caller's transaction.
 * Never weaken or bypass these writes (Section 8.5).
 *
 * The correlation id is resolved here rather than demanded from every
 * caller. That is a deliberate exception to "explicit over implicit":
 * `request_id` has been in this table since the first migration and was
 * empty in every row, because filling it depended on ~50 call sites each
 * remembering to thread a value through. One place that cannot forget
 * beats fifty that already did. A caller that has the id may still pass
 * it, and a job with no request scope legitimately writes null.
 */
export async function writeAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  let requestId = entry.requestId ?? null;
  if (requestId === null) {
    try {
      const { currentRequestId } = await import("@/lib/request-context");
      requestId = (await currentRequestId()) ?? null;
    } catch {
      // No request scope (job runner, seed script, test) — null is correct.
    }
  }
  await tx.insert(auditEvents).values({
    actorId: entry.actorId,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    action: entry.action,
    before: entry.before ?? null,
    after: entry.after ?? null,
    requestId,
  });
}

/** Append a domain event to the outbox in the same transaction (Section 4.3) */
export async function appendOutbox(
  tx: Tx,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(outboxEvents).values({ eventType, payload });
}
