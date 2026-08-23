import { NextResponse } from "next/server";
import {
  handleApiError,
  parseBody,
  readJsonBody,
  requireApiActor,
  withIdempotency,
} from "@/lib/api";
import { sendMessageSchema } from "@/lib/api-schemas";
import {
  getOrCreateThread,
  listMessages,
  listThreadsForRfq,
  sendMessage,
} from "@/modules/messaging/service";

export const dynamic = "force-dynamic";

/**
 * Messaging on an RFQ — one thread per RFQ↔supplier pair (Section 5/M3),
 * exposed as a client-neutral endpoint. `listThreadsForRfq` already scopes
 * what each role may see: a buyer/ops sees every pair thread, a supplier
 * sees only their own.
 */

/** Threads on the RFQ, each with its messages, scoped to the caller. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiActor("messages:read");
    const { id: rfqId } = await params;
    const threads = await listThreadsForRfq(actor, rfqId);
    const data = [];
    for (const thread of threads) {
      data.push({
        threadId: thread.id,
        companyId: thread.companyId,
        messages: await listMessages(actor, thread.id),
      });
    }
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

/** Post a message into the caller's thread on this RFQ. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiActor("messages:write");
    const { id: rfqId } = await params;
    const input = parseBody(sendMessageSchema, await readJsonBody(request));

    return await withIdempotency(request, { rfqId, ...input }, async () => {
      const thread = await getOrCreateThread(actor, rfqId, input.companyId);
      const message = await sendMessage(actor, thread.id, input.body);
      return {
        status: 201,
        body: { data: { threadId: thread.id, messageId: message.id } },
      };
    }, actor.userId);
  } catch (error) {
    return handleApiError(error);
  }
}
