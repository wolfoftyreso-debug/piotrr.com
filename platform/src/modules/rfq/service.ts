import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError, requireAnyRole, type Actor } from "@/modules/identity/rbac";
import { appendOutbox, writeAudit } from "@/modules/audit/service";
import { users } from "@/modules/identity/schema";
import { assertRfqTransition, type RfqStatus } from "./domain";
import { rfqAttachments, rfqDispatches, rfqs } from "./schema";

export type Rfq = typeof rfqs.$inferSelect;
export type RfqDispatch = typeof rfqDispatches.$inferSelect;
export type RfqAttachment = typeof rfqAttachments.$inferSelect;

export const rfqInputSchema = z.object({
  title: z.string().min(5).max(160),
  description: z.string().min(20).max(8000),
  siteAddress: z.string().max(300).optional(),
  siteCity: z.string().max(120).optional(),
  siteCountry: z.string().length(2).default("SE"),
  tradeId: z.string().uuid().optional(),
  headcountNeeded: z.coerce.number().int().min(1).max(500).optional(),
  startDate: z.coerce.date().optional(),
  durationWeeks: z.coerce.number().int().min(1).max(260).optional(),
  workingLanguage: z.string().max(20).optional(),
  budgetAmountMinor: z.coerce.number().int().min(0).optional(),
  budgetCurrency: z.enum(["EUR", "SEK", "DKK", "NOK", "PLN", "CZK"]).optional(),
});

export type RfqInput = z.infer<typeof rfqInputSchema>;

/**
 * Buyer RFQ intake (public + logged-in). For anonymous submissions a buyer
 * account is auto-created from the email (Section 5/M3); they complete
 * sign-in via the credentials/magic-link flow later.
 */
export async function findOrCreateBuyer(
  email: string,
  name: string,
  company?: { orgNumber?: string; companyName?: string; country?: string },
  opts?: { requireFresh?: boolean },
): Promise<{ userId: string; created: boolean }> {
  const normalized = email.toLowerCase();
  const existing = await db.query.users.findFirst({
    where: eq(users.email, normalized),
  });
  if (existing) {
    // Anonymous intake proves no control of the mailbox. Binding to a staff
    // or supplier account is never allowed — it would let anyone who knows a
    // colleague's or a supplier's address plant RFQs in their portal and the
    // ops queue.
    if (existing.role !== "buyer") {
      throw new ForbiddenError(
        "An account with this email already exists — sign in to submit a request.",
      );
    }
    // For the unauthenticated intake path (`requireFresh`): a buyer whose
    // owner has proven the mailbox must sign in — filing under it would plant
    // in a live portal. "Proven" is EITHER a password (registered) OR a set
    // emailVerifiedAt (a magic-link sign-in stamps it; shell buyers never get
    // a password, so passwordHash alone would miss them). Only a pure shell —
    // no password AND no verified email, which only a prior anonymous RFQ
    // could have created — is reused, which keeps intake idempotent under
    // retries (a failed createRfq or a lost idempotency row must not strand
    // the submitter). Trusted callers (seeding) skip requireFresh.
    if (opts?.requireFresh && (existing.passwordHash || existing.emailVerifiedAt)) {
      throw new ForbiddenError(
        "An account with this email already exists — sign in to file this request under it.",
      );
    }
    return { userId: existing.id, created: false };
  }

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email: normalized,
        name,
        role: "buyer",
        buyerOrgNumber: company?.orgNumber,
        buyerCompanyName: company?.companyName,
        buyerCountry: company?.country,
      })
      .returning();
    if (!user) throw new Error("Buyer creation failed");
    await writeAudit(tx, {
      actorId: user.id,
      entityType: "user",
      entityId: user.id,
      action: "user.auto_created_on_rfq",
      after: { role: "buyer" },
    });
    await appendOutbox(tx, "identity.user_registered", {
      userId: user.id,
      role: "buyer",
      source: "rfq_intake",
    });
    return { userId: user.id, created: true };
  });
}

export async function createRfq(
  buyerUserId: string,
  input: RfqInput,
  attachments: { fileName: string; contentType: string; objectKey: string }[] = [],
): Promise<Rfq> {
  const parsed = rfqInputSchema.parse(input);

  return db.transaction(async (tx) => {
    const [rfq] = await tx
      .insert(rfqs)
      .values({
        buyerUserId,
        title: parsed.title,
        description: parsed.description,
        siteAddress: parsed.siteAddress,
        siteCity: parsed.siteCity,
        siteCountry: parsed.siteCountry,
        tradeId: parsed.tradeId,
        headcountNeeded: parsed.headcountNeeded,
        startDate: parsed.startDate,
        durationWeeks: parsed.durationWeeks,
        workingLanguage: parsed.workingLanguage,
        budgetAmountMinor: parsed.budgetAmountMinor,
        budgetCurrency: parsed.budgetCurrency,
      })
      .returning();
    if (!rfq) throw new Error("RFQ insert failed");

    if (attachments.length > 0) {
      await tx.insert(rfqAttachments).values(
        attachments.map((a) => ({
          rfqId: rfq.id,
          fileName: a.fileName,
          contentType: a.contentType,
          objectKey: a.objectKey,
          uploadedBy: buyerUserId,
        })),
      );
    }

    await writeAudit(tx, {
      actorId: buyerUserId,
      entityType: "rfq",
      entityId: rfq.id,
      action: "rfq.created",
      after: { title: parsed.title, tradeId: parsed.tradeId },
    });
    await appendOutbox(tx, "rfq.created", { rfqId: rfq.id });
    return rfq;
  });
}

async function transition(
  actor: Actor,
  rfqId: string,
  to: RfqStatus,
  extra: Partial<typeof rfqs.$inferInsert> = {},
): Promise<Rfq> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(rfqs)
      .where(eq(rfqs.id, rfqId))
      .for("update");
    if (!existing) throw new Error("RFQ not found");
    assertRfqTransition(existing.status as RfqStatus, to);

    const [updated] = await tx
      .update(rfqs)
      .set({ status: to, statusChangedAt: new Date(), updatedAt: new Date(), ...extra })
      .where(eq(rfqs.id, rfqId))
      .returning();
    if (!updated) throw new Error("RFQ update failed");

    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "rfq",
      entityId: rfqId,
      action: `rfq.${to}`,
      before: { status: existing.status },
      after: { status: to },
    });
    await appendOutbox(tx, "rfq.status_changed", {
      rfqId,
      from: existing.status,
      to,
    });
    return updated;
  });
}

/** Ops qualifies the RFQ (concierge step 1) */
export async function qualifyRfq(actor: Actor, rfqId: string): Promise<Rfq> {
  requireAnyRole(actor, ["ops", "admin"]);
  return transition(actor, rfqId, "qualified", { qualifiedBy: actor.userId });
}

export async function markRfqStatus(
  actor: Actor,
  rfqId: string,
  to: "lost" | "expired" | "accepted",
): Promise<Rfq> {
  requireAnyRole(actor, ["ops", "admin"]);
  return transition(actor, rfqId, to);
}

/** Closing on acceptance may be done by the RFQ's buyer or by ops */
export async function closeRfqAccepted(
  actor: Actor,
  rfqId: string,
): Promise<Rfq> {
  const rfq = await getRfq(rfqId);
  if (!rfq) throw new Error("RFQ not found");
  const isBuyerOwner =
    actor.role === "buyer" && rfq.buyerUserId === actor.userId;
  const isOps = actor.role === "ops" || actor.role === "admin";
  if (!isBuyerOwner && !isOps) {
    throw new Error("Only the RFQ owner or ops can close the RFQ");
  }
  return transition(actor, rfqId, "accepted");
}

/** Ops selects candidate suppliers and dispatches (concierge step 2) */
export async function dispatchRfq(
  actor: Actor,
  rfqId: string,
  companyIds: string[],
  note?: string,
): Promise<void> {
  requireAnyRole(actor, ["ops", "admin"]);
  if (companyIds.length === 0) throw new Error("Select at least one supplier");

  const rfq = await getRfq(rfqId);
  if (!rfq) throw new Error("RFQ not found");

  // A verification badge is destination-specific. Dispatching a supplier
  // who is verified for Sweden to a German site would show the buyer a
  // badge that means nothing where the work happens — so the platform
  // refuses rather than leaving it to ops to remember.
  const { isCompanyVerifiedForDestination } = await import(
    "@/modules/verification/service"
  );
  const notVerified: string[] = [];
  for (const companyId of companyIds) {
    if (!(await isCompanyVerifiedForDestination(companyId, rfq.siteCountry))) {
      notVerified.push(companyId);
    }
  }
  if (notVerified.length > 0) {
    throw new Error(
      `Not verified for work in ${rfq.siteCountry}: ${notVerified.length} of ` +
        `${companyIds.length} selected supplier(s). Open a verification case ` +
        `for that corridor first.`,
    );
  }

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(rfqs)
      .where(eq(rfqs.id, rfqId))
      .for("update");
    if (!existing) throw new Error("RFQ not found");

    if (existing.status === "qualified") {
      assertRfqTransition("qualified", "dispatched");
      await tx
        .update(rfqs)
        .set({ status: "dispatched", statusChangedAt: new Date(), updatedAt: new Date() })
        .where(eq(rfqs.id, rfqId));
    } else if (existing.status !== "dispatched") {
      throw new Error("RFQ must be qualified before dispatch");
    }

    const already = await tx
      .select({ companyId: rfqDispatches.companyId })
      .from(rfqDispatches)
      .where(eq(rfqDispatches.rfqId, rfqId));
    const seen = new Set(already.map((d) => d.companyId));
    const fresh = companyIds.filter((id) => !seen.has(id));

    if (fresh.length > 0) {
      await tx.insert(rfqDispatches).values(
        fresh.map((companyId) => ({
          rfqId,
          companyId,
          dispatchedBy: actor.userId,
          note,
        })),
      );
    }

    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "rfq",
      entityId: rfqId,
      action: "rfq.dispatched",
      after: { companyIds: fresh, note },
    });
    for (const companyId of fresh) {
      await appendOutbox(tx, "rfq.dispatched_to_company", { rfqId, companyId });
    }
  });
}

/** Called by the offers module when the first offer lands */
export async function markOffersIn(actor: Actor, rfqId: string): Promise<void> {
  const existing = await db.query.rfqs.findFirst({ where: eq(rfqs.id, rfqId) });
  if (!existing) throw new Error("RFQ not found");
  if (existing.status === "offers_in") return;
  await transition(actor, rfqId, "offers_in");
}

export async function listRfqsByStatus(): Promise<Record<RfqStatus, Rfq[]>> {
  const all = await db
    .select()
    .from(rfqs)
    .where(isNull(rfqs.deletedAt))
    .orderBy(desc(rfqs.createdAt));
  const grouped: Record<RfqStatus, Rfq[]> = {
    new: [], qualified: [], dispatched: [], offers_in: [],
    accepted: [], lost: [], expired: [],
  };
  for (const rfq of all) grouped[rfq.status as RfqStatus].push(rfq);
  return grouped;
}

export async function getRfq(rfqId: string): Promise<Rfq | undefined> {
  return db.query.rfqs.findFirst({
    where: and(eq(rfqs.id, rfqId), isNull(rfqs.deletedAt)),
  });
}

export async function listRfqsForBuyer(buyerUserId: string): Promise<Rfq[]> {
  return db
    .select()
    .from(rfqs)
    .where(and(eq(rfqs.buyerUserId, buyerUserId), isNull(rfqs.deletedAt)))
    .orderBy(desc(rfqs.createdAt));
}

export async function listDispatchesForCompany(
  companyId: string,
): Promise<{ dispatch: RfqDispatch; rfq: Rfq }[]> {
  const rows = await db
    .select({ dispatch: rfqDispatches, rfq: rfqs })
    .from(rfqDispatches)
    .innerJoin(rfqs, eq(rfqs.id, rfqDispatches.rfqId))
    .where(eq(rfqDispatches.companyId, companyId))
    .orderBy(desc(rfqDispatches.createdAt));
  return rows;
}

export async function listDispatchedCompanyIds(rfqId: string): Promise<string[]> {
  const rows = await db
    .select({ companyId: rfqDispatches.companyId })
    .from(rfqDispatches)
    .where(eq(rfqDispatches.rfqId, rfqId));
  return rows.map((r) => r.companyId);
}

export async function isCompanyDispatched(
  rfqId: string,
  companyId: string,
): Promise<boolean> {
  const row = await db.query.rfqDispatches.findFirst({
    where: and(
      eq(rfqDispatches.rfqId, rfqId),
      eq(rfqDispatches.companyId, companyId),
    ),
  });
  return !!row;
}

export async function listAttachments(rfqId: string): Promise<RfqAttachment[]> {
  return db
    .select()
    .from(rfqAttachments)
    .where(eq(rfqAttachments.rfqId, rfqId))
    .orderBy(asc(rfqAttachments.createdAt));
}

export async function listRfqsByIds(ids: string[]): Promise<Rfq[]> {
  if (ids.length === 0) return [];
  return db.select().from(rfqs).where(inArray(rfqs.id, ids));
}

/**
 * Qualified requests a verified supplier may answer without waiting for ops
 * to hand-pick them (audit item 3: ops was a bottleneck in every deal).
 *
 * The quality gate is unchanged — ops still qualifies the request, and only
 * suppliers verified FOR THE DESTINATION COUNTRY can see it. What changes is
 * that ops no longer has to be in the room for the supplier to respond.
 */
export async function listOpenRfqsForSupplier(
  actor: Actor,
  companyId: string,
): Promise<Rfq[]> {
  requireAnyRole(actor, ["supplier", "ops", "admin"]);

  const { isCompanyVerifiedForDestination } = await import(
    "@/modules/verification/service",
  );

  const open = await db
    .select()
    .from(rfqs)
    .where(
      and(
        isNull(rfqs.deletedAt),
        inArray(rfqs.status, ["qualified", "dispatched", "offers_in"]),
      ),
    )
    .orderBy(desc(rfqs.createdAt))
    .limit(50);

  const visible: Rfq[] = [];
  for (const rfq of open) {
    if (await isCompanyVerifiedForDestination(companyId, rfq.siteCountry)) {
      visible.push(rfq);
    }
  }
  return visible;
}

/**
 * A verified supplier opting in to a qualified request. Records the same
 * dispatch row ops would have created, so offers, messaging and the audit
 * trail behave identically downstream.
 */
export async function selfDispatch(
  actor: Actor,
  rfqId: string,
  companyId: string,
): Promise<void> {
  requireAnyRole(actor, ["supplier"]);

  const rfq = await getRfq(rfqId);
  if (!rfq) throw new Error("RFQ not found");
  if (!["qualified", "dispatched", "offers_in"].includes(rfq.status)) {
    throw new Error("This request is not open for offers");
  }

  const { isCompanyVerifiedForDestination } = await import(
    "@/modules/verification/service",
  );
  if (!(await isCompanyVerifiedForDestination(companyId, rfq.siteCountry))) {
    throw new Error(
      `Your company is not verified for work in ${rfq.siteCountry}`,
    );
  }

  if (await isCompanyDispatched(rfqId, companyId)) return;

  await db.transaction(async (tx) => {
    if (rfq.status === "qualified") {
      await tx
        .update(rfqs)
        .set({ status: "dispatched", statusChangedAt: new Date(), updatedAt: new Date() })
        .where(eq(rfqs.id, rfqId));
    }
    await tx.insert(rfqDispatches).values({
      rfqId,
      companyId,
      dispatchedBy: actor.userId,
      note: "Supplier opted in",
    });
    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "rfq",
      entityId: rfqId,
      action: "rfq.supplier_opted_in",
      after: { companyId },
    });
    await appendOutbox(tx, "rfq.supplier_opted_in", { rfqId, companyId });
  });
}

/**
 * A request may only reach suppliers once we know who is asking: the buyer
 * carries beställaransvar, and a supplier quoting on the work is entitled to
 * know the counterparty. Ops sees the gap on the RFQ before dispatching.
 */
export async function buyerIdentityGaps(buyerUserId: string): Promise<string[]> {
  const buyer = await db.query.users.findFirst({
    where: eq(users.id, buyerUserId),
  });
  if (!buyer) return ["account missing"];
  const gaps: string[] = [];
  if (!buyer.emailVerifiedAt) gaps.push("email not verified");
  if (!buyer.buyerOrgNumber) gaps.push("organisation number missing");
  if (!buyer.buyerCompanyName) gaps.push("company name missing");
  return gaps;
}
