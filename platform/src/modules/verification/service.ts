import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { ForbiddenError, requireAnyRole, type Actor } from "@/modules/identity/rbac";
import { appendOutbox, writeAudit } from "@/modules/audit/service";
import { getRequirementsForCorridor } from "@/modules/catalog/service";
import { corridors } from "@/modules/catalog/schema";
import {
  assertCaseTransition,
  assertItemTransition,
  caseReadyForVerified,
  runExpiryCheck,
  type CaseState,
  type ItemStatus,
} from "./domain";
import { opsTasks, verificationCases, verificationItems } from "./schema";

export type VerificationCase = typeof verificationCases.$inferSelect;
export type VerificationItem = typeof verificationItems.$inferSelect;

/** Open (or fetch) the verification case for a company+corridor and
 * materialize one item per company-scope requirement plus per-worker items. */
export async function openCase(
  actor: Actor,
  params: { companyId: string; corridorId: string; workerIds?: string[] },
): Promise<VerificationCase> {
  requireAnyRole(actor, ["ops", "admin"]);

  const existing = await db.query.verificationCases.findFirst({
    where: and(
      eq(verificationCases.companyId, params.companyId),
      eq(verificationCases.corridorId, params.corridorId),
    ),
  });
  if (existing) return existing;

  const requirements = await getRequirementsForCorridor(params.corridorId);

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(verificationCases)
      .values({
        companyId: params.companyId,
        corridorId: params.corridorId,
        assignedOpsUserId: actor.userId,
      })
      .returning();
    if (!created) throw new Error("Failed to create case");

    const itemRows = requirements.flatMap((req) => {
      if (req.scope === "worker") {
        return (params.workerIds ?? []).map((workerId) => ({
          caseId: created.id,
          requirementDefinitionId: req.id,
          workerId,
        }));
      }
      return [{ caseId: created.id, requirementDefinitionId: req.id }];
    });
    if (itemRows.length > 0) {
      await tx.insert(verificationItems).values(itemRows);
    }

    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "verification_case",
      entityId: created.id,
      action: "case.opened",
      after: { companyId: params.companyId, corridorId: params.corridorId },
    });
    await appendOutbox(tx, "verification.case_opened", {
      caseId: created.id,
      companyId: params.companyId,
    });
    return created;
  });
}

export async function transitionCase(
  actor: Actor,
  caseId: string,
  to: CaseState,
  note?: string,
): Promise<VerificationCase> {
  requireAnyRole(actor, ["ops", "admin"]);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(verificationCases)
      .where(eq(verificationCases.id, caseId))
      .for("update");
    if (!existing) throw new Error("Case not found");

    assertCaseTransition(existing.state as CaseState, to);

    if (to === "verified") {
      const items = await tx
        .select({ status: verificationItems.status })
        .from(verificationItems)
        .where(eq(verificationItems.caseId, caseId));
      if (!caseReadyForVerified(items as { status: ItemStatus }[])) {
        throw new Error(
          "Cannot verify: every requirement item must be approved first",
        );
      }
    }

    const [updated] = await tx
      .update(verificationCases)
      .set({
        state: to,
        stateChangedAt: new Date(),
        note: note ?? existing.note,
        updatedAt: new Date(),
      })
      .where(eq(verificationCases.id, caseId))
      .returning();
    if (!updated) throw new Error("Case update failed");

    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "verification_case",
      entityId: caseId,
      action: `case.${to}`,
      before: { state: existing.state },
      after: { state: to, note },
    });
    await appendOutbox(tx, "verification.case_state_changed", {
      caseId,
      from: existing.state,
      to,
    });
    return updated;
  });
}

/** Move an item through its lifecycle; decisions record reviewer + note. */
export async function transitionItem(
  actor: Actor,
  itemId: string,
  to: ItemStatus,
  params: {
    decisionNote?: string;
    metadata?: Record<string, unknown>;
    validFrom?: Date | null;
    validUntil?: Date | null;
    documentIds?: string[];
  } = {},
): Promise<VerificationItem> {
  requireAnyRole(actor, ["ops", "admin", "supplier"]);
  const isDecision = to === "approved" || to === "rejected";
  if (isDecision) requireAnyRole(actor, ["ops", "admin"]);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(verificationItems)
      .where(eq(verificationItems.id, itemId))
      .for("update");
    if (!existing) throw new Error("Verification item not found");

    // Knowing an item id is not authorisation. Without this, any supplier
    // could move another company's verification item and attach evidence
    // to it — cross-tenant tampering with the legally sensitive record.
    if (actor.role === "supplier") {
      const [owning] = await tx
        .select({ companyId: verificationCases.companyId })
        .from(verificationCases)
        .where(eq(verificationCases.id, existing.caseId))
        .limit(1);
      const { getCompanyByOwner } = await import("@/modules/companies/service");
      const own = await getCompanyByOwner(actor.userId);
      if (!own || !owning || own.id !== owning.companyId) {
        throw new ForbiddenError("Verification item not found");
      }
      // …and the evidence attached must be their own too.
      if (params.documentIds?.length) {
        const { documentsOwnedBy } = await import("@/modules/documents/service");
        const mine = await documentsOwnedBy(params.documentIds, own.id);
        if (mine.length !== params.documentIds.length) {
          throw new ForbiddenError("You can only attach your own documents");
        }
      }
    }

    assertItemTransition(existing.status as ItemStatus, to);

    // Evidence the scanner flagged can never carry an approval (Section 4.7).
    if (to === "approved") {
      const attached = params.documentIds ?? existing.documentIds ?? [];
      const { infectedDocumentIds } = await import("@/modules/documents/service");
      const infected = await infectedDocumentIds(attached);
      if (infected.length > 0) {
        throw new Error(
          `Cannot approve: ${infected.length} attached document(s) failed the malware scan`,
        );
      }

      // A CRITICAL requirement cannot be approved on nothing. Measured: an
      // item approved with empty documentIds and no note still flipped the
      // badge — and the public profile then claims "granskade dokument —
      // F-skatt, A1, försäkring och certifikat" for a company whose
      // evidence was never recorded. That is the exact risk a buyer pays
      // to remove. So a critical approval must carry either an attached
      // document or a written justification in the decision note; the note
      // covers the genuine attestations (reference projects, collective-
      // agreement status) where the evidence is not an uploaded file.
      //
      // Non-critical items are left to reviewer judgement, and which
      // requirements demand an *uploaded file* specifically is a per-
      // corridor compliance decision recorded in the catalogue, not here.
      const [owningCase] = await tx
        .select({ corridorId: verificationCases.corridorId })
        .from(verificationCases)
        .where(eq(verificationCases.id, existing.caseId))
        .limit(1);
      const reqs = owningCase
        ? await getRequirementsForCorridor(owningCase.corridorId)
        : [];
      const isCritical =
        reqs.find((r) => r.id === existing.requirementDefinitionId)?.critical === 1;
      const note = (params.decisionNote ?? existing.decisionNote ?? "").trim();
      if (isCritical && attached.length === 0 && note.length === 0) {
        throw new Error(
          "A critical requirement cannot be approved without evidence: attach a " +
            "document, or record the basis in the decision note",
        );
      }
    }

    const [updated] = await tx
      .update(verificationItems)
      .set({
        status: to,
        metadata: params.metadata ?? existing.metadata,
        validFrom: params.validFrom ?? existing.validFrom,
        validUntil: params.validUntil ?? existing.validUntil,
        documentIds: params.documentIds ?? existing.documentIds,
        reviewedBy: isDecision ? actor.userId : existing.reviewedBy,
        decisionNote: isDecision
          ? (params.decisionNote ?? null)
          : existing.decisionNote,
        decidedAt: isDecision ? new Date() : existing.decidedAt,
        updatedAt: new Date(),
      })
      .where(eq(verificationItems.id, itemId))
      .returning();
    if (!updated) throw new Error("Item update failed");

    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "verification_item",
      entityId: itemId,
      action: `item.${to}`,
      before: { status: existing.status },
      after: { status: to, decisionNote: params.decisionNote },
    });
    await appendOutbox(tx, "verification.item_status_changed", {
      itemId,
      caseId: existing.caseId,
      from: existing.status,
      to,
    });
    return updated;
  });
}

export async function listCasesByState(): Promise<
  Record<CaseState, VerificationCase[]>
> {
  const all = await db
    .select()
    .from(verificationCases)
    .orderBy(asc(verificationCases.createdAt));
  const grouped: Record<CaseState, VerificationCase[]> = {
    draft: [],
    in_review: [],
    verified: [],
    suspended: [],
    expired: [],
  };
  for (const c of all) grouped[c.state as CaseState].push(c);
  return grouped;
}

export async function getCaseWithItems(caseId: string) {
  const kase = await db.query.verificationCases.findFirst({
    where: eq(verificationCases.id, caseId),
  });
  if (!kase) return null;
  const items = await db
    .select()
    .from(verificationItems)
    .where(eq(verificationItems.caseId, caseId))
    .orderBy(asc(verificationItems.createdAt));
  return { case: kase, items };
}

/** Public badge lookup: binary, derived only from case state */
export async function isCompanyVerified(
  companyId: string,
  corridorId: string,
): Promise<boolean> {
  const kase = await db.query.verificationCases.findFirst({
    where: and(
      eq(verificationCases.companyId, companyId),
      eq(verificationCases.corridorId, corridorId),
    ),
  });
  return kase?.state === "verified";
}

/**
 * Platform-verified facts for the public "Verified for work in Sweden"
 * panel (M2). Only facts backed by APPROVED verification items are exposed
 * — no self-reported claims. Exported service interface (Section 4.2).
 */
export interface VerifiedFacts {
  verified: boolean;
  verifiedSince: Date | null;
  facts: {
    key: string;
    nameEn: string;
    nameSv: string;
    nameLt: string;
    nameLv?: string | null;
    nameEt?: string | null;
    namePl?: string | null;
    scope: string;
    validUntil: Date | null;
    metadata: Record<string, unknown>;
    workerCount?: number;
  }[];
}

export async function getVerifiedFacts(
  companyId: string,
  corridorId: string,
): Promise<VerifiedFacts> {
  const kase = await db.query.verificationCases.findFirst({
    where: and(
      eq(verificationCases.companyId, companyId),
      eq(verificationCases.corridorId, corridorId),
    ),
  });
  if (!kase || kase.state !== "verified") {
    return { verified: false, verifiedSince: null, facts: [] };
  }

  const items = await db
    .select()
    .from(verificationItems)
    .where(
      and(
        eq(verificationItems.caseId, kase.id),
        eq(verificationItems.status, "approved"),
      ),
    );

  const requirements = await getRequirementsForCorridor(corridorId);
  const reqById = new Map(requirements.map((r) => [r.id, r]));

  // Group worker-scoped approvals per requirement (e.g. "A1 × 6 workers")
  const grouped = new Map<
    string,
    { item: (typeof items)[number]; workerCount: number }
  >();
  for (const item of items) {
    const existing = grouped.get(item.requirementDefinitionId);
    if (existing) {
      existing.workerCount += item.workerId ? 1 : 0;
      // Keep the earliest expiring validity for honesty
      if (
        item.validUntil &&
        (!existing.item.validUntil || item.validUntil < existing.item.validUntil)
      ) {
        existing.item = item;
      }
    } else {
      grouped.set(item.requirementDefinitionId, {
        item,
        workerCount: item.workerId ? 1 : 0,
      });
    }
  }

  const facts = [...grouped.entries()].flatMap(([reqId, entry]) => {
    const req = reqById.get(reqId);
    if (!req) return [];
    return [
      {
        key: req.key,
        nameEn: req.nameEn,
        nameSv: req.nameSv,
        nameLt: req.nameLt,
        nameLv: req.nameLv,
        nameEt: req.nameEt,
        namePl: req.namePl,
        scope: req.scope,
        validUntil: entry.item.validUntil,
        metadata: (entry.item.metadata ?? {}) as Record<string, unknown>,
        workerCount: entry.workerCount || undefined,
      },
    ];
  });

  return { verified: true, verifiedSince: kase.stateChangedAt, facts };
}

/** Approved worker-scoped certifications for a company+corridor, grouped by
 * worker — used by the offers module to freeze team cert status (M3). */
export async function getApprovedWorkerCerts(
  companyId: string,
  corridorId: string,
): Promise<Map<string, { requirementKey: string; validUntil: Date | null }[]>> {
  const result = new Map<
    string,
    { requirementKey: string; validUntil: Date | null }[]
  >();

  const kase = await db.query.verificationCases.findFirst({
    where: and(
      eq(verificationCases.companyId, companyId),
      eq(verificationCases.corridorId, corridorId),
    ),
  });
  if (!kase) return result;

  const items = await db
    .select()
    .from(verificationItems)
    .where(
      and(
        eq(verificationItems.caseId, kase.id),
        eq(verificationItems.status, "approved"),
      ),
    );

  const requirements = await getRequirementsForCorridor(corridorId);
  const keyByReq = new Map(requirements.map((r) => [r.id, r.key]));

  for (const item of items) {
    if (!item.workerId) continue;
    const key = keyByReq.get(item.requirementDefinitionId);
    if (!key) continue;
    const list = result.get(item.workerId) ?? [];
    list.push({ requirementKey: key, validUntil: item.validUntil });
    result.set(item.workerId, list);
  }
  return result;
}

/** Ops task creation — exported service interface so other modules never
 * touch this module's tables (Section 4.2) */
export async function createOpsTask(input: {
  title: string;
  detail?: string;
  companyId?: string;
  caseId?: string;
  dueAt?: Date;
}): Promise<void> {
  await db.insert(opsTasks).values(input);
}

// ---------------------------------------------------------------------------
// Expiry engine — invoked by the nightly pg-boss job
// ---------------------------------------------------------------------------
export async function runExpirySweep(now: Date): Promise<{
  warned: number;
  expiredItems: number;
  expiredCases: number;
}> {
  const cases = await db.select().from(verificationCases);
  let warned = 0;
  let expiredItems = 0;
  let expiredCases = 0;

  for (const kase of cases) {
    const items = await db
      .select()
      .from(verificationItems)
      .where(eq(verificationItems.caseId, kase.id));
    if (items.length === 0) continue;

    const reqs = await getRequirementsForCorridor(kase.corridorId);
    const criticalByReq = new Map(reqs.map((r) => [r.id, r.critical === 1]));

    const result = runExpiryCheck(
      items.map((item) => {
        const meta = (item.metadata ?? {}) as { warnedDays?: number[] };
        return {
          itemId: item.id,
          status: item.status as ItemStatus,
          validUntil: item.validUntil,
          critical: criticalByReq.get(item.requirementDefinitionId) ?? true,
          warnedDays: meta.warnedDays ?? [],
        };
      }),
      now,
    );

    await db.transaction(async (tx) => {
      for (const warning of result.warnings) {
        const item = items.find((i) => i.id === warning.itemId);
        if (!item) continue;
        const meta = (item.metadata ?? {}) as { warnedDays?: number[] };
        await tx
          .update(verificationItems)
          .set({
            metadata: {
              ...(item.metadata as Record<string, unknown>),
              warnedDays: [...(meta.warnedDays ?? []), warning.window],
            },
            updatedAt: now,
          })
          .where(eq(verificationItems.id, warning.itemId));
        await tx.insert(opsTasks).values({
          title: `Document expires in ${warning.daysUntilExpiry} days`,
          detail: `Verification item ${warning.itemId} (case ${kase.id})`,
          companyId: kase.companyId,
          caseId: kase.id,
          itemId: warning.itemId,
          dueAt: now,
        });
        await appendOutbox(tx, "verification.item_expiry_warning", {
          itemId: warning.itemId,
          caseId: kase.id,
          companyId: kase.companyId,
          daysUntilExpiry: warning.daysUntilExpiry,
          window: warning.window,
        });
        warned += 1;
      }

      if (result.expiredItemIds.length > 0) {
        await tx
          .update(verificationItems)
          .set({ status: "expired", updatedAt: now })
          .where(inArray(verificationItems.id, result.expiredItemIds));
        expiredItems += result.expiredItemIds.length;

        for (const itemId of result.expiredItemIds) {
          await writeAudit(tx, {
            actorId: null,
            entityType: "verification_item",
            entityId: itemId,
            action: "item.expired",
            after: { reason: "validity lapsed (expiry engine)" },
          });
        }
      }

      // A lapsed critical document automatically expires the case and
      // hides the badge (Section 5/M1)
      if (result.caseExpired && kase.state === "verified") {
        await tx
          .update(verificationCases)
          .set({ state: "expired", stateChangedAt: now, updatedAt: now })
          .where(eq(verificationCases.id, kase.id));
        await writeAudit(tx, {
          actorId: null,
          entityType: "verification_case",
          entityId: kase.id,
          action: "case.expired",
          before: { state: kase.state },
          after: { state: "expired", reason: "critical document lapsed" },
        });
        await appendOutbox(tx, "verification.case_state_changed", {
          caseId: kase.id,
          from: kase.state,
          to: "expired",
        });
        expiredCases += 1;
      }
    });
  }

  return { warned, expiredItems, expiredCases };
}

/**
 * Corridors a company actually has verification cases on, newest first.
 *
 * Callers must never assume a corridor: a Polish supplier is verified on
 * pl-se, a Latvian one on lv-se, and as the platform opens further EU
 * destinations one supplier will hold several cases at once. Looking up a
 * hard-coded corridor makes a genuinely verified company render as
 * unverified — and freezes that falsehood into offer snapshots.
 */
export async function listCasesForCompany(companyId: string) {
  return db
    .select()
    .from(verificationCases)
    .where(eq(verificationCases.companyId, companyId))
    .orderBy(desc(verificationCases.createdAt));
}

/**
 * The corridor to show a company under: its verified case if it has one,
 * otherwise the most recent case, otherwise the corridor matching the
 * company's home country. Returns null when nothing matches.
 */
export async function resolveCompanyCorridorId(
  companyId: string,
  homeCountry?: string,
): Promise<string | null> {
  const cases = await listCasesForCompany(companyId);
  const verified = cases.find((c) => c.state === "verified");
  if (verified) return verified.corridorId;
  if (cases[0]) return cases[0].corridorId;

  if (homeCountry) {
    const corridor = await db.query.corridors.findFirst({
      where: eq(corridors.fromCountry, homeCountry.toUpperCase()),
    });
    return corridor?.id ?? null;
  }
  return null;
}

/**
 * Verified facts without the caller having to know the corridor.
 * Empty (verified: false) when the company has no case at all.
 */
export async function getVerifiedFactsForCompany(
  companyId: string,
  homeCountry?: string,
): Promise<VerifiedFacts> {
  const corridorId = await resolveCompanyCorridorId(companyId, homeCountry);
  if (!corridorId) return { verified: false, verifiedSince: null, facts: [] };
  return getVerifiedFacts(companyId, corridorId);
}

/**
 * Is this company verified for work in a specific DESTINATION country?
 *
 * A supplier verified on lt-se is verified for Sweden — not for Germany.
 * Matching and the public badge must both go through this, otherwise a
 * buyer sees a verification that means nothing where the work happens.
 */
export async function isCompanyVerifiedForDestination(
  companyId: string,
  destinationCountry: string,
): Promise<boolean> {
  const rows = await db
    .select({ state: verificationCases.state })
    .from(verificationCases)
    .innerJoin(corridors, eq(corridors.id, verificationCases.corridorId))
    .where(
      and(
        eq(verificationCases.companyId, companyId),
        eq(corridors.toCountry, destinationCountry.toUpperCase()),
      ),
    );
  return rows.some((r) => r.state === "verified");
}

/** Destination countries this company is currently verified for. */
export async function verifiedDestinations(
  companyId: string,
): Promise<string[]> {
  const rows = await db
    .select({ to: corridors.toCountry, state: verificationCases.state })
    .from(verificationCases)
    .innerJoin(corridors, eq(corridors.id, verificationCases.corridorId))
    .where(eq(verificationCases.companyId, companyId));
  return [...new Set(rows.filter((r) => r.state === "verified").map((r) => r.to))];
}

/**
 * Verified facts for a specific destination. Falls back to "not verified"
 * rather than silently answering about a different country.
 */
export async function getVerifiedFactsForDestination(
  companyId: string,
  destinationCountry: string,
): Promise<VerifiedFacts & { destination: string }> {
  const rows = await db
    .select({ corridorId: verificationCases.corridorId })
    .from(verificationCases)
    .innerJoin(corridors, eq(corridors.id, verificationCases.corridorId))
    .where(
      and(
        eq(verificationCases.companyId, companyId),
        eq(corridors.toCountry, destinationCountry.toUpperCase()),
      ),
    )
    .limit(1);

  const corridorId = rows[0]?.corridorId;
  const facts = corridorId
    ? await getVerifiedFacts(companyId, corridorId)
    : { verified: false, verifiedSince: null, facts: [] };
  return { ...facts, destination: destinationCountry.toUpperCase() };
}
