"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { currentActor } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  createRfq,
  findOrCreateBuyer,
  rfqInputSchema,
} from "@/modules/rfq/service";

export async function submitRfqAction(formData: FormData) {
  const headerList = await headers();
  const ip =
    clientIp(headerList);
  const limited = rateLimit(`rfq:${ip}`, { limit: 20, windowMs: 60 * 60 * 1000 });
  if (!limited.allowed) throw new Error("Too many requests — try again later");

  const locale = String(formData.get("locale") ?? "sv");

  const budgetMajor = String(formData.get("budget") ?? "");
  const input = rfqInputSchema.parse({
    title: formData.get("title"),
    description: formData.get("description"),
    siteAddress: String(formData.get("siteAddress") ?? "") || undefined,
    siteCity: String(formData.get("siteCity") ?? "") || undefined,
    siteCountry: String(formData.get("siteCountry") ?? "SE").toUpperCase(),
    tradeId: String(formData.get("tradeId") ?? "") || undefined,
    headcountNeeded: String(formData.get("headcountNeeded") ?? "") || undefined,
    startDate: String(formData.get("startDate") ?? "") || undefined,
    durationWeeks: String(formData.get("durationWeeks") ?? "") || undefined,
    workingLanguage: String(formData.get("workingLanguage") ?? "") || undefined,
    budgetAmountMinor: budgetMajor ? Math.round(Number(budgetMajor) * 100) : undefined,
    budgetCurrency: budgetMajor
      ? (String(formData.get("budgetCurrency") ?? "SEK") as "EUR" | "SEK")
      : undefined,
  });

  const actor = await currentActor();
  let buyerUserId: string;
  if (actor) {
    buyerUserId = actor.userId;
  } else {
    const email = String(formData.get("buyerEmail") ?? "");
    const name = String(formData.get("buyerName") ?? "");
    if (!email || !name) throw new Error("Email and name are required");
    const buyer = await findOrCreateBuyer(
      email,
      name,
      {
        orgNumber: String(formData.get('buyerOrgNumber') ?? '') || undefined,
        companyName: String(formData.get('buyerCompanyName') ?? '') || undefined,
        country: String(formData.get('siteCountry') ?? 'SE').toUpperCase(),
      },
      { requireFresh: true },
    );
    buyerUserId = buyer.userId;
  }

  await createRfq(buyerUserId, input);
  redirect(`/${locale}/request-work/thanks`);
}
