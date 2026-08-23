import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { appendOutbox, writeAudit } from "@/modules/audit/service";
import { companies } from "@/modules/companies/schema";
import { users } from "@/modules/identity/schema";
import { ForbiddenError, requireAnyRole, type Actor } from "@/modules/identity/rbac";
import { agreements, agreementSignatures } from "./schema";
import {
  assertAgreementTransition,
  canonicalDocument,
  documentHash,
  EMPTY_TERMS,
  fullySigned,
  openQuestions,
  readyToPropose,
  staleSignatures,
  type AgreementState,
  type AgreementTerms,
  type OpenQuestion,
  type Party,
} from "./domain";

export type Agreement = typeof agreements.$inferSelect;
export type AgreementSignature = typeof agreementSignatures.$inferSelect;

export interface AgreementView {
  agreement: Agreement;
  terms: AgreementTerms;
  signatures: AgreementSignature[];
  openQuestions: OpenQuestion[];
  /** Signatures made on an earlier text — surfaced, never quietly dropped. */
  stale: AgreementSignature[];
  canPropose: boolean;
  complete: boolean;
}

function hashIp(ip: string | null | undefined): string | null {
  return ip
    ? createHash("sha256").update(`${env.AUTH_SECRET}:${ip}`).digest("hex").slice(0, 32)
    : null;
}

async function partyNames(companyId: string, buyerUserId: string) {
  const [company] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  const [buyer] = await db
    .select({ name: users.name, email: users.email, org: users.buyerCompanyName })
    .from(users)
    .where(eq(users.id, buyerUserId))
    .limit(1);
  return {
    supplierName: company?.name ?? companyId,
    buyerName: buyer?.org || buyer?.name || buyer?.email || buyerUserId,
  };
}

async function render(
  agreementId: string,
  terms: AgreementTerms,
  companyId: string,
  buyerUserId: string,
  version: number,
) {
  const { supplierName, buyerName } = await partyNames(companyId, buyerUserId);
  const text = canonicalDocument(terms, { agreementId, buyerName, supplierName, version });
  return { text, hash: documentHash(text) };
}

/**
 * Open the agreement for an accepted offer. Ops does this — the same
 * concierge step that records the deal — so both parties start from one
 * document rather than two email drafts.
 */
export async function openAgreement(
  actor: Actor,
  input: {
    rfqId: string;
    offerId: string;
    companyId: string;
    buyerUserId: string;
    threadId?: string | null;
    terms?: Partial<AgreementTerms>;
  },
): Promise<Agreement> {
  requireAnyRole(actor, ["ops", "admin"]);

  const existing = await db.query.agreements.findFirst({
    where: eq(agreements.offerId, input.offerId),
  });
  if (existing) throw new Error("This offer already has an agreement");

  const terms: AgreementTerms = { ...EMPTY_TERMS, ...input.terms };
  const id = crypto.randomUUID();
  const { text, hash } = await render(id, terms, input.companyId, input.buyerUserId, 1);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(agreements)
      .values({
        id,
        rfqId: input.rfqId,
        offerId: input.offerId,
        companyId: input.companyId,
        buyerUserId: input.buyerUserId,
        threadId: input.threadId ?? null,
        terms,
        documentText: text,
        documentHash: hash,
        createdBy: actor.userId,
      })
      .returning();
    if (!row) throw new Error("Agreement insert failed");

    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "agreement",
      entityId: row.id,
      action: "agreement.opened",
      after: { offerId: input.offerId, documentHash: hash },
    });
    await appendOutbox(tx, "agreements.opened", {
      agreementId: row.id,
      companyId: input.companyId,
      rfqId: input.rfqId,
    });
    return row;
  });
}

/**
 * Change the terms.
 *
 * Any edit bumps the version and re-hashes the document, which is what
 * invalidates earlier signatures. A signed agreement cannot be edited at
 * all — it has to be superseded by a new one, so the signed text survives
 * as a record.
 */
export async function updateTerms(
  actor: Actor,
  agreementId: string,
  patch: Partial<AgreementTerms>,
): Promise<AgreementView> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(agreements)
      .where(eq(agreements.id, agreementId))
      .for("update");
    if (!row) throw new Error("No such agreement");
    await assertParty(actor, row);

    if (row.state === "signed" || row.state === "superseded" || row.state === "cancelled") {
      throw new Error(
        "A signed agreement cannot be edited — supersede it with a new one instead",
      );
    }

    const terms: AgreementTerms = { ...(row.terms as AgreementTerms), ...patch };
    const version = row.version + 1;
    const { text, hash } = await render(
      row.id, terms, row.companyId, row.buyerUserId, version,
    );

    const [updated] = await tx
      .update(agreements)
      .set({
        terms,
        version,
        documentText: text,
        documentHash: hash,
        // Editing a proposal reopens it: nobody signs a moving target.
        state: row.state === "proposed" ? "draft" : row.state,
        updatedAt: new Date(),
      })
      .where(eq(agreements.id, agreementId))
      .returning();
    if (!updated) throw new Error("Agreement update failed");

    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "agreement",
      entityId: agreementId,
      action: "agreement.terms_changed",
      before: { version: row.version, documentHash: row.documentHash },
      after: { version, documentHash: hash, changed: Object.keys(patch) },
    });
    return view(updated, await signaturesOf(tx, agreementId));
  });
}

export async function transition(
  actor: Actor,
  agreementId: string,
  to: AgreementState,
): Promise<Agreement> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(agreements)
      .where(eq(agreements.id, agreementId))
      .for("update");
    if (!row) throw new Error("No such agreement");
    await assertParty(actor, row);

    assertAgreementTransition(row.state as AgreementState, to);
    if (to === "proposed" && !readyToPropose(row.terms as AgreementTerms)) {
      throw new Error("Some essential terms are still unanswered");
    }

    const [updated] = await tx
      .update(agreements)
      .set({
        state: to,
        cancelledAt: to === "cancelled" ? new Date() : row.cancelledAt,
        updatedAt: new Date(),
      })
      .where(eq(agreements.id, agreementId))
      .returning();
    if (!updated) throw new Error("Agreement transition failed");

    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "agreement",
      entityId: agreementId,
      action: `agreement.${to}`,
      before: { state: row.state },
      after: { state: to },
    });
    return updated;
  });
}

/**
 * Sign the document as it currently reads.
 *
 * The caller passes the hash their screen showed. If it no longer matches,
 * the terms moved under them and the signature is refused — that check is
 * the difference between a signature and a click.
 */
export async function sign(
  actor: Actor,
  agreementId: string,
  input: { expectedHash: string; signerName: string; ip?: string | null; userAgent?: string | null },
): Promise<AgreementView> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(agreements)
      .where(eq(agreements.id, agreementId))
      .for("update");
    if (!row) throw new Error("No such agreement");

    const party = await partyOf(actor, row);
    if (row.state !== "proposed") {
      throw new Error("This agreement is not open for signing");
    }
    if (input.expectedHash !== row.documentHash) {
      throw new Error(
        "The agreement changed while you were reading it — review the new version before signing",
      );
    }
    if (!input.signerName?.trim()) throw new Error("Enter the name of the person signing");

    await tx
      .insert(agreementSignatures)
      .values({
        agreementId,
        party,
        signedByUserId: actor.userId,
        signerName: input.signerName.trim().slice(0, 200),
        documentHash: row.documentHash,
        ipHash: hashIp(input.ip),
        userAgent: input.userAgent?.slice(0, 300) ?? null,
      })
      .onConflictDoNothing();

    const sigs = await signaturesOf(tx, agreementId);
    const complete = fullySigned(sigs, row.documentHash);

    let current = row;
    if (complete) {
      const [done] = await tx
        .update(agreements)
        .set({ state: "signed", signedAt: new Date(), updatedAt: new Date() })
        .where(eq(agreements.id, agreementId))
        .returning();
      if (done) current = done;
      await appendOutbox(tx, "agreements.signed", {
        agreementId,
        companyId: row.companyId,
        documentHash: row.documentHash,
      });
    }

    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "agreement",
      entityId: agreementId,
      action: "agreement.signed_by_party",
      after: { party, documentHash: row.documentHash, complete },
    });

    return view(current, sigs);
  });
}

export async function getAgreement(
  actor: Actor,
  agreementId: string,
): Promise<AgreementView> {
  const row = await db.query.agreements.findFirst({
    where: eq(agreements.id, agreementId),
  });
  if (!row) throw new Error("No such agreement");
  await assertParty(actor, row);
  return view(row, await signaturesOf(db, agreementId));
}

export async function agreementForOffer(offerId: string): Promise<Agreement | undefined> {
  return db.query.agreements.findFirst({ where: eq(agreements.offerId, offerId) });
}

/* ------------------------------------------------------------------ */

type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function signaturesOf(conn: Db, agreementId: string) {
  return conn
    .select()
    .from(agreementSignatures)
    .where(eq(agreementSignatures.agreementId, agreementId))
    .orderBy(desc(agreementSignatures.signedAt));
}

function view(row: Agreement, signatures: AgreementSignature[]): AgreementView {
  const terms = row.terms as AgreementTerms;
  return {
    agreement: row,
    terms,
    signatures: signatures.filter((s) => s.documentHash === row.documentHash),
    stale: staleSignatures(signatures, row.documentHash) as AgreementSignature[],
    openQuestions: openQuestions(terms),
    canPropose: readyToPropose(terms),
    complete: fullySigned(signatures, row.documentHash),
  };
}

/** Which side of the table the actor sits on. */
async function partyOf(actor: Actor, row: Agreement): Promise<Party> {
  if (row.buyerUserId === actor.userId) return "buyer";
  const [company] = await db
    .select({ ownerUserId: companies.ownerUserId })
    .from(companies)
    .where(eq(companies.id, row.companyId))
    .limit(1);
  if (company?.ownerUserId === actor.userId) return "supplier";
  // Ops may read and prepare, but signing binds a party — never staff.
  throw new ForbiddenError("Only the buyer or the supplier can sign this agreement");
}

async function assertParty(actor: Actor, row: Agreement): Promise<void> {
  if (actor.role === "ops" || actor.role === "admin") return;
  if (row.buyerUserId === actor.userId) return;
  const [company] = await db
    .select({ ownerUserId: companies.ownerUserId })
    .from(companies)
    .where(eq(companies.id, row.companyId))
    .limit(1);
  if (company?.ownerUserId === actor.userId) return;
  throw new ForbiddenError("This agreement belongs to another party");
}

export { openQuestions, readyToPropose, type AgreementTerms, type OpenQuestion };
