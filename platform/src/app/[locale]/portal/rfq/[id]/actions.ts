"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentActor } from "@/lib/auth";
import { ForbiddenError } from "@/modules/identity/rbac";
import { acceptOffer, submitOffer } from "@/modules/offers/service";
import {
  getOrCreateThread,
  sendMessage,
} from "@/modules/messaging/service";

async function actorOrThrow() {
  const actor = await currentActor();
  if (!actor) throw new ForbiddenError("Not authenticated");
  return actor;
}

export async function submitOfferAction(formData: FormData) {
  const actor = await actorOrThrow();
  const amountMajor = z.coerce.number().min(1).parse(formData.get("amount"));
  await submitOffer(actor, {
    rfqId: z.string().uuid().parse(formData.get("rfqId")),
    rateModel: z.enum(["hourly", "fixed"]).parse(formData.get("rateModel")),
    amountMinor: Math.round(amountMajor * 100),
    currency: z.enum(["EUR", "SEK"]).parse(formData.get("currency")),
    earliestStart: formData.get("earliestStart")
      ? new Date(String(formData.get("earliestStart")))
      : undefined,
    validUntil: formData.get("validUntil")
      ? new Date(String(formData.get("validUntil")))
      : undefined,
    note: String(formData.get("note") ?? "") || undefined,
    workerIds: formData.getAll("workerIds").map((w) => z.string().uuid().parse(w)),
  });
  revalidatePath("/[locale]/portal/rfq/[id]", "page");
}

export async function acceptOfferAction(formData: FormData) {
  const actor = await actorOrThrow();
  await acceptOffer(actor, z.string().uuid().parse(formData.get("offerId")));
  revalidatePath("/[locale]/portal/rfq/[id]", "page");
}

export async function sendThreadMessageAction(formData: FormData) {
  const actor = await actorOrThrow();
  const rfqId = z.string().uuid().parse(formData.get("rfqId"));
  const companyId = z.string().uuid().parse(formData.get("companyId"));
  const thread = await getOrCreateThread(actor, rfqId, companyId);
  await sendMessage(actor, thread.id, String(formData.get("body") ?? ""));
  revalidatePath("/[locale]/portal/rfq/[id]", "page");
}
