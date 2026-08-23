import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Currency } from "@/lib/money";
import { ForbiddenError, requireAnyRole, type Actor } from "@/modules/identity/rbac";
import { appendOutbox, writeAudit } from "@/modules/audit/service";
import { getCompanyByOwner, listWorkers } from "@/modules/companies/service";
import {
  getApprovedWorkerCerts,
  getVerifiedFacts,
  resolveCompanyCorridorId,
} from "@/modules/verification/service";
import {
  getRfq,
  isCompanyDispatched,
  markOffersIn,
} from "@/modules/rfq/service";
import {
  assertOfferTransition,
  buildVerificationSnapshot,
  type OfferStatus,
  type VerificationSnapshot,
} from "./domain";
import { deals, offers, offerTeamMembers } from "./schema";

export type Offer = typeof offers.$inferSelect;
export type OfferTeamMember = typeof offerTeamMembers.$inferSelect;
export type Deal = typeof deals.$inferSelect;

export const offerInputSchema = z.object({
  rfqId: z.string().uuid(),
  rateModel: z.enum(["hourly", "fixed"]),
  amountMinor: z.coerce.number().int().min(1),
  currency: z.enum(["EUR", "SEK", "DKK", "NOK", "PLN", "CZK"]),
  earliestStart: z.coerce.date().optional(),
  validUntil: z.coerce.date().optional(),
  note: z.string().max(4000).optional(),
  workerIds: z.array(z.string().uuid()).min(1),
});

export type OfferInput = z.infer<typeof offerInputSchema>;

/**
 * Supplier submits an offer on a dispatched RFQ. The verification snapshot
 * is FROZEN here — the buyer sees what was true at submission time even if
 * verification changes later (legally sensitive; audited).
 */
export async function submitOffer(
  actor: Actor,
  input: OfferInput,
  now: Date = new Date(),
): Promise<Offer> {
  requireAnyRole(actor, ["supplier", "ops", "admin"]);
  const parsed = offerInputSchema.parse(input);

  const company =
    actor.role === "supplier" ? await getCompanyByOwner(actor.userId) : null;
  if (actor.role === "supplier" && !company) {
    throw new Error("No company for this account");
  }
  const companyId = company?.id;
  if (!companyId) throw new Error("Offers must be submitted by a supplier");

  const rfq = await getRfq(parsed.rfqId);
  if (!rfq) throw new Error("RFQ not found");
  if (!["dispatched", "offers_in"].includes(rfq.status)) {
    throw new Error("RFQ is not open for offers");
  }
  if (!(await isCompanyDispatched(parsed.rfqId, companyId))) {
    throw new Error("This RFQ was not dispatched to your company");
  }

  const existing = await db.query.offers.findFirst({
    where: and(eq(offers.rfqId, parsed.rfqId), eq(offers.companyId, companyId)),
  });
  if (existing && existing.status === "submitted") {
    throw new Error("Your company already has an open offer on this RFQ");
  }

  // Freeze verification state at submission time. The corridor is the one
  // this company actually holds a case on — never a hard-coded default, or
  // a verified non-Lithuanian supplier would freeze "unverified" forever.
  const corridorId = await resolveCompanyCorridorId(companyId, company?.country);
  const facts = corridorId
    ? await getVerifiedFacts(companyId, corridorId)
    : { verified: false, verifiedSince: null, facts: [] };
  const workerCerts = corridorId
    ? await getApprovedWorkerCerts(companyId, corridorId)
    : new Map<string, { requirementKey: string; validUntil: Date | null }[]>();
  const companyWorkers = await listWorkers(companyId);
  const workerById = new Map(companyWorkers.map((w) => [w.id, w]));

  const team = parsed.workerIds.map((workerId) => {
    const worker = workerById.get(workerId);
    if (!worker) throw new Error("Team member does not belong to your company");
    return {
      workerId,
      workerName: worker.name,
      tradeRole: worker.tradeRole,
      approvedCerts: workerCerts.get(workerId) ?? [],
    };
  });

  const snapshot: VerificationSnapshot = buildVerificationSnapshot(
    facts,
    team,
    now,
  );

  return db.transaction(async (tx) => {
    const [offer] = await tx
      .insert(offers)
      .values({
        rfqId: parsed.rfqId,
        companyId,
        rateModel: parsed.rateModel,
        amountMinor: parsed.amountMinor,
        currency: parsed.currency,
        earliestStart: parsed.earliestStart,
        validUntil: parsed.validUntil,
        note: parsed.note,
        verificationSnapshot: snapshot,
        submittedBy: actor.userId,
      })
      .returning();
    if (!offer) throw new Error("Offer insert failed");

    await tx.insert(offerTeamMembers).values(
      team.map((member) => ({
        offerId: offer.id,
        workerId: member.workerId,
        workerName: member.workerName,
        tradeRole: member.tradeRole,
        certStatus: member.approvedCerts,
      })),
    );

    // Offer submissions are legally sensitive — full audit (Section 4.4)
    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "offer",
      entityId: offer.id,
      action: "offer.submitted",
      after: {
        rfqId: parsed.rfqId,
        companyId,
        amountMinor: parsed.amountMinor,
        currency: parsed.currency,
        rateModel: parsed.rateModel,
        snapshotFrozenAt: snapshot.frozenAt,
        companyVerifiedAtSubmission: snapshot.companyVerified,
      },
    });
    await appendOutbox(tx, "offers.submitted", {
      offerId: offer.id,
      rfqId: parsed.rfqId,
      companyId,
    });
    return offer;
  }).then(async (offer) => {
    // First offer moves the RFQ to offers_in
    await markOffersIn(actor, parsed.rfqId);
    return offer;
  });
}

/** Buyer (RFQ owner) or ops accepts an offer; siblings are rejected */
export async function acceptOffer(
  actor: Actor,
  offerId: string,
  now: Date = new Date(),
): Promise<Offer> {
  const offer = await db.query.offers.findFirst({ where: eq(offers.id, offerId) });
  if (!offer) throw new Error("Offer not found");
  const rfq = await getRfq(offer.rfqId);
  if (!rfq) throw new Error("RFQ not found");

  const isBuyerOwner = actor.role === "buyer" && rfq.buyerUserId === actor.userId;
  const isOps = actor.role === "ops" || actor.role === "admin";
  if (!isBuyerOwner && !isOps) {
    throw new Error("Only the RFQ owner or ops can accept an offer");
  }

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(offers)
      .where(eq(offers.id, offerId))
      .for("update");
    if (!current) throw new Error("Offer not found");

    // The supplier set validUntil to mean "this price holds until then".
    // Accepting after it silently bound them to a lapsed quote — measured:
    // an offer dated yesterday accepted cleanly. The `expired` state in the
    // offer machine existed for exactly this and was never used. Refuse,
    // with a message the buyer can act on: ask for a fresh offer.
    if (current.validUntil && current.validUntil.getTime() < now.getTime()) {
      throw new Error(
        "This offer's validity date has passed — ask the supplier for a fresh offer",
      );
    }

    assertOfferTransition(current.status as OfferStatus, "accepted");

    const [updated] = await tx
      .update(offers)
      .set({ status: "accepted", updatedAt: new Date() })
      .where(eq(offers.id, offerId))
      .returning();
    if (!updated) throw new Error("Offer update failed");

    // Reject open sibling offers
    const siblings = await tx
      .select()
      .from(offers)
      .where(and(eq(offers.rfqId, offer.rfqId), eq(offers.status, "submitted")));
    for (const sibling of siblings) {
      if (sibling.id === offerId) continue;
      await tx
        .update(offers)
        .set({ status: "rejected", updatedAt: new Date() })
        .where(eq(offers.id, sibling.id));
      await writeAudit(tx, {
        actorId: actor.userId,
        entityType: "offer",
        entityId: sibling.id,
        action: "offer.rejected",
        after: { reason: "another offer accepted" },
      });
    }

    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "offer",
      entityId: offerId,
      action: "offer.accepted",
      after: { rfqId: offer.rfqId },
    });
    await appendOutbox(tx, "offers.accepted", {
      offerId,
      rfqId: offer.rfqId,
      companyId: offer.companyId,
    });
    return updated;
  }).then(async (updated) => {
    const { closeRfqAccepted } = await import("@/modules/rfq/service");
    await closeRfqAccepted(actor, offer.rfqId);
    return updated;
  });
}

export async function withdrawOffer(actor: Actor, offerId: string): Promise<void> {
  requireAnyRole(actor, ["supplier", "ops", "admin"]);
  const offer = await db.query.offers.findFirst({ where: eq(offers.id, offerId) });
  if (!offer) throw new Error("Offer not found");
  if (actor.role === "supplier") {
    const company = await getCompanyByOwner(actor.userId);
    if (company?.id !== offer.companyId) {
      throw new Error("Suppliers can only manage their own offers");
    }
  }
  assertOfferTransition(offer.status as OfferStatus, "withdrawn");

  await db.transaction(async (tx) => {
    await tx
      .update(offers)
      .set({ status: "withdrawn", updatedAt: new Date() })
      .where(eq(offers.id, offerId));
    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "offer",
      entityId: offerId,
      action: "offer.withdrawn",
    });
  });
}


/**
 * Flip offers past their validity date to `expired`.
 *
 * Two things this fixes together with the accept-time guard: a stale
 * offer stops showing to the buyer as if it were live, and — the part
 * that surfaced in testing — it stops blocking the supplier, who cannot
 * submit a fresh quote while an old one is still `submitted`. The
 * `expired` state existed in the offer machine from the start and had
 * never been reached. Runs from the nightly expiry sweep.
 */
export async function expireStaleOffers(now: Date = new Date()): Promise<number> {
  const stale = await db
    .select({ id: offers.id, rfqId: offers.rfqId, companyId: offers.companyId })
    .from(offers)
    .where(and(eq(offers.status, "submitted"), lt(offers.validUntil, now)));
  if (stale.length === 0) return 0;

  await db.transaction(async (tx) => {
    for (const o of stale) {
      await tx.update(offers).set({ status: "expired", updatedAt: now }).where(eq(offers.id, o.id));
      await writeAudit(tx, {
        actorId: null,
        entityType: "offer",
        entityId: o.id,
        action: "offer.expired",
        after: { reason: "validity date passed" },
      });
    }
  });
  return stale.length;
}

export async function listOffersForRfq(
  rfqId: string,
): Promise<(Offer & { team: OfferTeamMember[] })[]> {
  const rows = await db
    .select()
    .from(offers)
    .where(eq(offers.rfqId, rfqId))
    .orderBy(desc(offers.createdAt));
  const result = [];
  for (const offer of rows) {
    const team = await db
      .select()
      .from(offerTeamMembers)
      .where(eq(offerTeamMembers.offerId, offer.id));
    result.push({ ...offer, team });
  }
  return result;
}

/**
 * Offers for an RFQ, filtered to what this actor may see — the same rule
 * the RFQ room UI enforces, lifted into the service so the `/api/v1` route
 * cannot reimplement (and drift from) the authorization:
 *   - buyer who owns the RFQ, and ops/admin, see every offer (the
 *     comparison view);
 *   - a supplier dispatched to the RFQ sees only their own offer, never a
 *     competitor's bid;
 *   - anyone else is refused.
 */
export async function listOffersForRfqAs(
  actor: Actor,
  rfqId: string,
): Promise<(Offer & { team: OfferTeamMember[] })[]> {
  const rfq = await getRfq(rfqId);
  if (!rfq) throw new Error("RFQ not found");

  const isBuyerOwner = actor.role === "buyer" && rfq.buyerUserId === actor.userId;
  const isOps = actor.role === "ops" || actor.role === "admin";
  if (isBuyerOwner || isOps) {
    return listOffersForRfq(rfqId);
  }

  if (actor.role === "supplier") {
    const company = await getCompanyByOwner(actor.userId);
    if (company && (await isCompanyDispatched(rfqId, company.id))) {
      const all = await listOffersForRfq(rfqId);
      return all.filter((o) => o.companyId === company.id);
    }
  }
  throw new ForbiddenError("No access to this RFQ's offers");
}

export async function listOffersForCompany(companyId: string): Promise<Offer[]> {
  return db
    .select()
    .from(offers)
    .where(eq(offers.companyId, companyId))
    .orderBy(desc(offers.createdAt));
}

// ---------------------------------------------------------------------------
// Deals — recorded by ops on acceptance; invoiced manually (no payments)
// ---------------------------------------------------------------------------
export async function recordDeal(
  actor: Actor,
  input: {
    offerId: string;
    contractValueMinor: number;
    currency: Currency;
    successFeePct: number;
    note?: string;
  },
): Promise<Deal> {
  requireAnyRole(actor, ["ops", "admin"]);

  const offer = await db.query.offers.findFirst({
    where: eq(offers.id, input.offerId),
  });
  if (!offer) throw new Error("Offer not found");
  if (offer.status !== "accepted") {
    throw new Error("Deals can only be recorded for accepted offers");
  }
  const rfq = await getRfq(offer.rfqId);
  if (!rfq) throw new Error("RFQ not found");

  return db.transaction(async (tx) => {
    const [deal] = await tx
      .insert(deals)
      .values({
        rfqId: offer.rfqId,
        offerId: offer.id,
        companyId: offer.companyId,
        buyerUserId: rfq.buyerUserId,
        contractValueMinor: input.contractValueMinor,
        currency: input.currency,
        successFeePct: String(input.successFeePct),
        note: input.note,
        recordedBy: actor.userId,
      })
      .returning();
    if (!deal) throw new Error("Deal insert failed");

    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "deal",
      entityId: deal.id,
      action: "deal.recorded",
      after: {
        offerId: offer.id,
        contractValueMinor: input.contractValueMinor,
        currency: input.currency,
        successFeePct: input.successFeePct,
      },
    });
    await appendOutbox(tx, "deals.recorded", { dealId: deal.id });
    return deal;
  });
}

export async function getDealForRfq(rfqId: string): Promise<Deal | undefined> {
  return db.query.deals.findFirst({ where: eq(deals.rfqId, rfqId) });
}

export async function listDeals(actor: Actor): Promise<Deal[]> {
  requireAnyRole(actor, ["ops", "admin"]);
  return db.select().from(deals).orderBy(desc(deals.createdAt));
}

/** CSV export for manual invoicing (M3 DoD) */
export async function dealsCsv(actor: Actor): Promise<string> {
  const rows = await listDeals(actor);
  const header =
    "deal_id,recorded_at,rfq_id,offer_id,company_id,contract_value_minor,currency,success_fee_pct,fee_amount_minor,note";
  const lines = rows.map((deal) => {
    const fee = Math.round(
      (deal.contractValueMinor * Number(deal.successFeePct)) / 100,
    );
    const note = (deal.note ?? "").replaceAll('"', '""');
    return [
      deal.id,
      deal.createdAt.toISOString(),
      deal.rfqId,
      deal.offerId,
      deal.companyId,
      deal.contractValueMinor,
      deal.currency,
      deal.successFeePct,
      fee,
      `"${note}"`,
    ].join(",");
  });
  return [header, ...lines].join("\n");
}
