/**
 * Offers domain (M3). The verification snapshot is FROZEN at submission
 * time: the buyer's comparison view must show what was true when the
 * supplier submitted, even if verification changes afterwards.
 * Covered by mandatory unit tests (Section 8.4).
 */

export type OfferStatus =
  | "submitted"
  | "withdrawn"
  | "accepted"
  | "rejected"
  | "expired";

const TRANSITIONS: Record<OfferStatus, OfferStatus[]> = {
  submitted: ["withdrawn", "accepted", "rejected", "expired"],
  withdrawn: [],
  accepted: [],
  rejected: [],
  expired: [],
};

export function canTransitionOffer(from: OfferStatus, to: OfferStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertOfferTransition(from: OfferStatus, to: OfferStatus): void {
  if (!canTransitionOffer(from, to)) {
    throw new Error(`Invalid offer transition: ${from} -> ${to}`);
  }
}

// ---------------------------------------------------------------------------
// Verification snapshot
// ---------------------------------------------------------------------------

export interface SnapshotInputFacts {
  verified: boolean;
  verifiedSince: Date | null;
  facts: {
    key: string;
    nameEn: string;
    scope: string;
    validUntil: Date | null;
    workerCount?: number;
  }[];
}

export interface WorkerCertInput {
  workerId: string;
  workerName: string;
  tradeRole: string | null;
  approvedCerts: { requirementKey: string; validUntil: Date | null }[];
}

export interface VerificationSnapshot {
  frozenAt: string; // ISO timestamp
  companyVerified: boolean;
  verifiedSince: string | null;
  facts: {
    key: string;
    nameEn: string;
    scope: string;
    validUntil: string | null;
    workerCount?: number;
  }[];
  team: {
    workerId: string;
    workerName: string;
    tradeRole: string | null;
    approvedCerts: { requirementKey: string; validUntil: string | null }[];
  }[];
}

/**
 * Build the immutable snapshot stored on the offer. Pure function of its
 * inputs and the provided clock — deterministic and testable.
 */
export function buildVerificationSnapshot(
  companyFacts: SnapshotInputFacts,
  team: WorkerCertInput[],
  now: Date,
): VerificationSnapshot {
  return {
    frozenAt: now.toISOString(),
    companyVerified: companyFacts.verified,
    verifiedSince: companyFacts.verifiedSince?.toISOString() ?? null,
    facts: companyFacts.facts.map((fact) => ({
      key: fact.key,
      nameEn: fact.nameEn,
      scope: fact.scope,
      validUntil: fact.validUntil?.toISOString() ?? null,
      workerCount: fact.workerCount,
    })),
    team: team.map((member) => ({
      workerId: member.workerId,
      workerName: member.workerName,
      tradeRole: member.tradeRole,
      approvedCerts: member.approvedCerts.map((cert) => ({
        requirementKey: cert.requirementKey,
        validUntil: cert.validUntil?.toISOString() ?? null,
      })),
    })),
  };
}
