import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import type { Actor } from "@/modules/identity/rbac";
import { appendOutbox, writeAudit } from "@/modules/audit/service";
import { getCompanyByOwner } from "@/modules/companies/service";
import { getRfq, isCompanyDispatched } from "@/modules/rfq/service";
import { messageThreads, threadMessages } from "./schema";

export type MessageThread = typeof messageThreads.$inferSelect;
export type ThreadMessage = typeof threadMessages.$inferSelect;

/**
 * Access: the RFQ's buyer, the thread company's owner, or ops/admin.
 *
 * The dispatch gate applies to SUPPLIERS ONLY. A supplier reaches a thread
 * only when their own company is actually dispatched to the RFQ — the same
 * gate that hides the RFQ room and blocks offer submission/listing. Without
 * it a supplier only had to know a company id (a public directory value) and
 * an RFQ id (mailed as a portal deep link) to open a private procurement
 * thread and message the buyer.
 *
 * The buyer who owns the RFQ, and ops/admin, are NEVER gated by dispatch:
 * they legitimately see every thread on the RFQ, including concierge threads
 * ops opened before a company was dispatched. Gating them too would make one
 * undispatched thread throw and take down the buyer's entire message listing
 * (the GET endpoint reads every thread), which is the opposite of the intent.
 */
async function assertThreadAccess(
  actor: Actor,
  rfqId: string,
  companyId: string,
): Promise<void> {
  if (actor.role === "ops" || actor.role === "admin") return;
  if (actor.role === "buyer") {
    const rfq = await getRfq(rfqId);
    if (rfq?.buyerUserId === actor.userId) return;
  }
  if (actor.role === "supplier") {
    const company = await getCompanyByOwner(actor.userId);
    if (
      company?.id === companyId &&
      (await isCompanyDispatched(rfqId, companyId))
    ) {
      return;
    }
  }
  throw new Error("No access to this conversation");
}

/** One thread per RFQ–supplier pair (Section 5/M3) */
export async function getOrCreateThread(
  actor: Actor,
  rfqId: string,
  companyId: string,
): Promise<MessageThread> {
  await assertThreadAccess(actor, rfqId, companyId);

  const existing = await db.query.messageThreads.findFirst({
    where: and(
      eq(messageThreads.rfqId, rfqId),
      eq(messageThreads.companyId, companyId),
    ),
  });
  if (existing) return existing;

  const [thread] = await db
    .insert(messageThreads)
    .values({ rfqId, companyId })
    .returning();
  if (!thread) throw new Error("Thread creation failed");
  return thread;
}

export async function listMessages(
  actor: Actor,
  threadId: string,
): Promise<ThreadMessage[]> {
  const thread = await db.query.messageThreads.findFirst({
    where: eq(messageThreads.id, threadId),
  });
  if (!thread) throw new Error("Thread not found");
  await assertThreadAccess(actor, thread.rfqId, thread.companyId);

  return db
    .select()
    .from(threadMessages)
    .where(eq(threadMessages.threadId, threadId))
    .orderBy(asc(threadMessages.createdAt));
}

export async function sendMessage(
  actor: Actor,
  threadId: string,
  body: string,
): Promise<ThreadMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Empty message");
  if (trimmed.length > 4000) throw new Error("Message too long");

  const thread = await db.query.messageThreads.findFirst({
    where: eq(messageThreads.id, threadId),
  });
  if (!thread) throw new Error("Thread not found");
  await assertThreadAccess(actor, thread.rfqId, thread.companyId);

  return db.transaction(async (tx) => {
    const [message] = await tx
      .insert(threadMessages)
      .values({ threadId, senderUserId: actor.userId, body: trimmed })
      .returning();
    if (!message) throw new Error("Message insert failed");

    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "thread_message",
      entityId: message.id,
      action: "message.sent",
      after: { threadId },
    });
    // Email notification with deep link handled by the outbox dispatcher
    await appendOutbox(tx, "messaging.message_sent", {
      threadId,
      messageId: message.id,
      rfqId: thread.rfqId,
      companyId: thread.companyId,
      senderUserId: actor.userId,
    });
    return message;
  });
}

export async function listThreadsForRfq(
  actor: Actor,
  rfqId: string,
): Promise<MessageThread[]> {
  const rfq = await getRfq(rfqId);
  if (!rfq) return [];
  if (
    actor.role !== "ops" &&
    actor.role !== "admin" &&
    !(actor.role === "buyer" && rfq.buyerUserId === actor.userId)
  ) {
    // Suppliers only see their own pair thread, and only once dispatched —
    // the same gate assertThreadAccess enforces. Returning [] here (rather
    // than a thread listMessages would then reject) keeps an undispatched
    // supplier's listing a clean empty rather than a 500.
    const company = await getCompanyByOwner(actor.userId);
    if (!company) return [];
    if (!(await isCompanyDispatched(rfqId, company.id))) return [];
    const thread = await db.query.messageThreads.findFirst({
      where: and(
        eq(messageThreads.rfqId, rfqId),
        eq(messageThreads.companyId, company.id),
      ),
    });
    return thread ? [thread] : [];
  }
  return db
    .select()
    .from(messageThreads)
    .where(eq(messageThreads.rfqId, rfqId))
    .orderBy(desc(messageThreads.createdAt));
}
