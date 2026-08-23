"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentActor } from "@/lib/auth";
import { requireAnyRole } from "@/modules/identity/rbac";
import {
  dispatchRfq,
  markRfqStatus,
  qualifyRfq,
} from "@/modules/rfq/service";
import { recordDeal } from "@/modules/offers/service";

async function opsActor() {
  return requireAnyRole(await currentActor(), ["ops", "admin"]);
}

export async function qualifyRfqAction(formData: FormData) {
  const actor = await opsActor();
  await qualifyRfq(actor, z.string().uuid().parse(formData.get("rfqId")));
  revalidatePath("/[locale]/admin/rfqs", "layout");
}

export async function markRfqStatusAction(formData: FormData) {
  const actor = await opsActor();
  await markRfqStatus(
    actor,
    z.string().uuid().parse(formData.get("rfqId")),
    z.enum(["lost", "expired"]).parse(formData.get("to")),
  );
  revalidatePath("/[locale]/admin/rfqs", "layout");
}

export async function dispatchRfqAction(formData: FormData) {
  const actor = await opsActor();
  await dispatchRfq(
    actor,
    z.string().uuid().parse(formData.get("rfqId")),
    formData.getAll("companyIds").map((c) => z.string().uuid().parse(c)),
    String(formData.get("note") ?? "") || undefined,
  );
  revalidatePath("/[locale]/admin/rfqs", "layout");
}

export async function recordDealAction(formData: FormData) {
  const actor = await opsActor();
  const contractValueMajor = z.coerce
    .number()
    .min(1)
    .parse(formData.get("contractValue"));
  await recordDeal(actor, {
    offerId: z.string().uuid().parse(formData.get("offerId")),
    contractValueMinor: Math.round(contractValueMajor * 100),
    currency: z.enum(["EUR", "SEK", "DKK", "NOK", "PLN", "CZK"]).parse(formData.get("currency")),
    successFeePct: z.coerce.number().min(0).max(100).parse(formData.get("successFeePct")),
    note: String(formData.get("note") ?? "") || undefined,
  });
  revalidatePath("/[locale]/admin", "layout");
}