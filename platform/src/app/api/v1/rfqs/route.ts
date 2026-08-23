import { z } from "zod";
import { apiError, handleApiError, parseBody, readJsonBody, withIdempotency } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { currentActor } from "@/lib/auth";
import {
  createRfq,
  findOrCreateBuyer,
  rfqInputSchema,
} from "@/modules/rfq/service";

export const dynamic = "force-dynamic";

const publicRfqSchema = rfqInputSchema.extend({
  buyerEmail: z.string().email().optional(),
  buyerName: z.string().min(1).max(120).optional(),
});

/**
 * Buyer RFQ intake — public + logged-in (Section 5/M3). Anonymous
 * submissions auto-create a buyer account from the email.
 */
export async function POST(request: Request) {
  const ip = clientIp(request.headers);
  const limited = rateLimit(`rfq:${ip}`, { limit: 20, windowMs: 60 * 60 * 1000 });
  if (!limited.allowed) {
    return apiError(429, "Too many requests — try again later");
  }

  try {
    const input = parseBody(publicRfqSchema, await readJsonBody(request));
    const actor = await currentActor();
    if (!actor && (!input.buyerEmail || !input.buyerName)) {
      return apiError(400, "buyerEmail and buyerName are required when not signed in");
    }

    // Namespace the idempotency key by the submitter: the signed-in user, or
    // the anonymous buyer email. Buyer resolution lives INSIDE the handler so
    // a genuine replay (same key) short-circuits before findOrCreateBuyer —
    // otherwise the retry would hit the just-created buyer and be refused by
    // the requireFresh guard. A first submission for a new email still fails
    // closed: a *different* key for an existing buyer re-runs and is refused.
    const namespace = actor
      ? `user:${actor.userId}`
      : `anon-email:${input.buyerEmail!.toLowerCase()}`;

    return await withIdempotency(
      request,
      input,
      async () => {
        let buyerUserId: string;
        if (actor) {
          buyerUserId = actor.userId;
        } else {
          const buyer = await findOrCreateBuyer(
            input.buyerEmail!,
            input.buyerName!,
            undefined,
            { requireFresh: true },
          );
          buyerUserId = buyer.userId;
        }
        const rfq = await createRfq(buyerUserId, input);
        return { status: 201, body: { data: { id: rfq.id, status: rfq.status } } };
      },
      namespace,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
