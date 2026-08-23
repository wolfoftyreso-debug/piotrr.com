import { createHash } from "node:crypto";

/**
 * Agreements (Appendix B decision 11).
 *
 * The platform documents what the two parties agreed and records that both
 * signed it. Three deliberate limits shape this module:
 *
 *  1. **The system does not author law.** An agreement is assembled from
 *     structured terms both parties confirm, rendered into a fixed
 *     document. We never generate contract prose and never advise.
 *  2. **A signature binds one exact text.** Every signature stores the
 *     SHA-256 of the document as signed. Change a term afterwards and the
 *     hash no longer matches, which voids the signatures rather than
 *     silently rewriting what someone agreed to. This is the same
 *     principle as the frozen verification snapshot on an offer.
 *  3. **Guidance points at gaps, it does not fill them.** `openQuestions`
 *     returns what is missing or ambiguous. A human decides the answer.
 */

export type AgreementState =
  | "draft"
  | "proposed"
  | "signed"
  | "cancelled"
  | "superseded";

const TRANSITIONS: Record<AgreementState, AgreementState[]> = {
  // Ops or either party is still filling in terms.
  draft: ["proposed", "cancelled"],
  // Locked for signing. Editing a term sends it back to draft on purpose.
  proposed: ["signed", "draft", "cancelled"],
  // Terminal for this document; a change means a new one supersedes it.
  signed: ["superseded"],
  cancelled: [],
  superseded: [],
};

export class InvalidAgreementTransition extends Error {
  constructor(from: AgreementState, to: AgreementState) {
    super(`Invalid agreement transition: ${from} -> ${to}`);
    this.name = "InvalidAgreementTransition";
  }
}

export function assertAgreementTransition(
  from: AgreementState,
  to: AgreementState,
): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new InvalidAgreementTransition(from, to);
  }
}

/* ------------------------------------------------------------------ */
/* Terms                                                               */
/* ------------------------------------------------------------------ */

export interface AgreementTerms {
  /** What is being built or done, in the parties' own words. */
  scope: string;
  /** Where. The destination country also decides the posting rules. */
  siteAddress: string;
  siteCountry: string;
  startDate: string | null;
  endDate: string | null;
  rateModel: "fixed" | "hourly" | null;
  amountMinor: number | null;
  currency: string | null;
  headcount: number | null;
  workingLanguage: string | null;
  /** Who supplies what — the most common source of a dispute. */
  suppliedByBuyer: string[];
  suppliedBySupplier: string[];
  paymentTerms: string | null;
  /** Delay, defects, termination. Free text the parties confirm. */
  delayTerms: string | null;
  warrantyTerms: string | null;
}

export const EMPTY_TERMS: AgreementTerms = {
  scope: "",
  siteAddress: "",
  siteCountry: "",
  startDate: null,
  endDate: null,
  rateModel: null,
  amountMinor: null,
  currency: null,
  headcount: null,
  workingLanguage: null,
  suppliedByBuyer: [],
  suppliedBySupplier: [],
  paymentTerms: null,
  delayTerms: null,
  warrantyTerms: null,
};

export interface OpenQuestion {
  field: keyof AgreementTerms;
  /** Blocking questions stop signing; advisory ones only warn. */
  severity: "blocking" | "advisory";
  question: string;
}

/**
 * What the parties have not settled yet.
 *
 * This is the whole of the "guidance": a checklist derived from the terms,
 * phrased as questions a person can answer. It never proposes an answer,
 * because an answer would be advice about their contract.
 */
export function openQuestions(terms: AgreementTerms): OpenQuestion[] {
  const q: OpenQuestion[] = [];
  const blank = (v: string | null | undefined) => !v || v.trim().length === 0;

  if (blank(terms.scope) || terms.scope.trim().length < 30) {
    q.push({
      field: "scope",
      severity: "blocking",
      question: "Beskriv arbetet så utförligt att en utomstående förstår vad som ingår och vad som inte gör det.",
    });
  }
  if (blank(terms.siteAddress)) {
    q.push({ field: "siteAddress", severity: "blocking", question: "Var ska arbetet utföras? Ange adress." });
  }
  if (blank(terms.siteCountry)) {
    q.push({
      field: "siteCountry",
      severity: "blocking",
      question: "I vilket land ligger arbetsplatsen? Landet avgör vilka utstationeringsregler som gäller.",
    });
  }
  if (!terms.startDate) {
    q.push({ field: "startDate", severity: "blocking", question: "Vilket datum ska arbetet börja?" });
  }
  if (!terms.endDate) {
    q.push({
      field: "endDate",
      severity: "advisory",
      question: "Finns ett slutdatum? Utan det är det svårt att avgöra vad som räknas som försening.",
    });
  }
  if (!terms.rateModel || terms.amountMinor == null || blank(terms.currency)) {
    q.push({
      field: "amountMinor",
      severity: "blocking",
      question: "Vad är priset, och är det fast pris eller timpris? Ange valuta.",
    });
  }
  if (terms.rateModel === "hourly" && !terms.endDate) {
    q.push({
      field: "endDate",
      severity: "blocking",
      question: "Vid timpris behöver ni ett tak eller ett slutdatum — annars är åtagandet obegränsat.",
    });
  }
  if (!terms.headcount) {
    q.push({ field: "headcount", severity: "advisory", question: "Hur många personer omfattar åtagandet?" });
  }
  if (blank(terms.workingLanguage)) {
    q.push({
      field: "workingLanguage",
      severity: "advisory",
      question: "Vilket språk ska arbetsledningen tala på plats?",
    });
  }
  if (terms.suppliedByBuyer.length === 0 && terms.suppliedBySupplier.length === 0) {
    q.push({
      field: "suppliedByBuyer",
      severity: "blocking",
      question:
        "Vem tillhandahåller vad — ställning, lyft, material, el, bod, verktyg? Det här är den vanligaste tvistefrågan.",
    });
  }
  if (blank(terms.paymentTerms)) {
    q.push({ field: "paymentTerms", severity: "blocking", question: "När och mot vad ska betalning ske?" });
  }
  if (blank(terms.delayTerms)) {
    q.push({
      field: "delayTerms",
      severity: "advisory",
      question: "Vad gäller vid försening? Utan en överenskommelse faller frågan tillbaka på allmänna regler.",
    });
  }
  if (blank(terms.warrantyTerms)) {
    q.push({ field: "warrantyTerms", severity: "advisory", question: "Vilken garanti- eller ansvarstid gäller för arbetet?" });
  }
  return q;
}

/** Signing is blocked while anything essential is unanswered. */
export function readyToPropose(terms: AgreementTerms): boolean {
  return openQuestions(terms).every((q) => q.severity !== "blocking");
}

/* ------------------------------------------------------------------ */
/* Document + signatures                                               */
/* ------------------------------------------------------------------ */

/**
 * Canonical, stable rendering of the terms.
 *
 * Key order is fixed by TERM_ORDER rather than by object insertion, so the
 * same agreement always hashes identically no matter how the object was
 * built. A hash that drifts with key order would void signatures at random.
 */
const TERM_ORDER: (keyof AgreementTerms)[] = [
  "scope", "siteAddress", "siteCountry", "startDate", "endDate",
  "rateModel", "amountMinor", "currency", "headcount", "workingLanguage",
  "suppliedByBuyer", "suppliedBySupplier", "paymentTerms", "delayTerms", "warrantyTerms",
];

export function canonicalDocument(
  terms: AgreementTerms,
  meta: { agreementId: string; buyerName: string; supplierName: string; version: number },
): string {
  const lines = [
    "BALTIC BRIDGE — AVTAL OM UNDERENTREPRENAD",
    `Avtals-id: ${meta.agreementId}`,
    `Version: ${meta.version}`,
    `Beställare: ${meta.buyerName}`,
    `Utförare: ${meta.supplierName}`,
    "",
  ];
  for (const key of TERM_ORDER) {
    const v = terms[key];
    const rendered = Array.isArray(v) ? v.join("; ") : v === null ? "" : String(v);
    lines.push(`${key}: ${rendered}`);
  }
  return lines.join("\n");
}

export function documentHash(document: string): string {
  return createHash("sha256").update(document, "utf8").digest("hex");
}

export type Party = "buyer" | "supplier";

export interface SignatureLike {
  party: Party;
  documentHash: string;
}

/**
 * An agreement counts as signed only when both parties have signed **the
 * same** document hash. A signature on an earlier version does not carry
 * over to an edited one.
 */
export function fullySigned(
  signatures: SignatureLike[],
  currentHash: string,
): boolean {
  const valid = signatures.filter((s) => s.documentHash === currentHash);
  return (
    valid.some((s) => s.party === "buyer") &&
    valid.some((s) => s.party === "supplier")
  );
}

/** Signatures that no longer match the current text — shown, never hidden. */
export function staleSignatures(
  signatures: SignatureLike[],
  currentHash: string,
): SignatureLike[] {
  return signatures.filter((s) => s.documentHash !== currentHash);
}
