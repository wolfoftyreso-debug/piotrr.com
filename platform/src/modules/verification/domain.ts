/**
 * Verification domain logic — pure functions, no I/O.
 * Covered by mandatory unit tests (Section 8.4).
 */

export type CaseState =
  | "draft"
  | "in_review"
  | "verified"
  | "suspended"
  | "expired";

export type ItemStatus =
  | "missing"
  | "submitted"
  | "in_review"
  | "approved"
  | "rejected"
  | "expired";

/** Allowed case state transitions (Section 5/M1) */
const CASE_TRANSITIONS: Record<CaseState, CaseState[]> = {
  draft: ["in_review"],
  in_review: ["verified", "draft"],
  verified: ["suspended", "expired"],
  suspended: ["in_review", "verified"],
  expired: ["in_review"],
};

export function canTransitionCase(from: CaseState, to: CaseState): boolean {
  return CASE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertCaseTransition(from: CaseState, to: CaseState): void {
  if (!canTransitionCase(from, to)) {
    throw new Error(`Invalid case transition: ${from} -> ${to}`);
  }
}

const ITEM_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  missing: ["submitted"],
  submitted: ["in_review", "missing"],
  in_review: ["approved", "rejected"],
  approved: ["expired", "in_review"],
  rejected: ["submitted"],
  expired: ["submitted"],
};

export function canTransitionItem(from: ItemStatus, to: ItemStatus): boolean {
  return ITEM_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertItemTransition(from: ItemStatus, to: ItemStatus): void {
  if (!canTransitionItem(from, to)) {
    throw new Error(`Invalid item transition: ${from} -> ${to}`);
  }
}

/**
 * The company badge derives ONLY from case state (binary verification —
 * never tiers, never for sale).
 */
export function badgeVisible(state: CaseState): boolean {
  return state === "verified";
}

/** A case may become verified only when every item is approved and unexpired */
export function caseReadyForVerified(
  items: { status: ItemStatus }[],
): boolean {
  return items.length > 0 && items.every((i) => i.status === "approved");
}

// ---------------------------------------------------------------------------
// Expiry engine
// ---------------------------------------------------------------------------

export const EXPIRY_WARNING_DAYS = [30, 14, 3] as const;

export interface ExpiryInput {
  itemId: string;
  status: ItemStatus;
  validUntil: Date | null;
  critical: boolean;
  /** Warning windows already flagged for this item (30/14/3) */
  warnedDays: number[];
}

export interface ExpiryWarning {
  itemId: string;
  daysUntilExpiry: number;
  window: number; // which warning window fired (30, 14 or 3)
}

export interface ExpiryResult {
  /** New warnings to create ops tasks + supplier emails for */
  warnings: ExpiryWarning[];
  /** Items whose validity lapsed -> item status must become 'expired' */
  expiredItemIds: string[];
  /** True if any lapsed item is critical -> case moves to 'expired', badge hidden */
  caseExpired: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysUntil(now: Date, until: Date): number {
  return Math.ceil((until.getTime() - now.getTime()) / MS_PER_DAY);
}

/**
 * Nightly expiry sweep for one case (Section 5/M1: test with simulated clock).
 */
export function runExpiryCheck(items: ExpiryInput[], now: Date): ExpiryResult {
  const warnings: ExpiryWarning[] = [];
  const expiredItemIds: string[] = [];
  let caseExpired = false;

  for (const item of items) {
    if (item.status !== "approved" || !item.validUntil) continue;

    const days = daysUntil(now, item.validUntil);

    if (days <= 0) {
      expiredItemIds.push(item.itemId);
      if (item.critical) caseExpired = true;
      continue;
    }

    // Tightest applicable window first (3 before 14 before 30)
    const ascending = [...EXPIRY_WARNING_DAYS].sort((a, b) => a - b);
    for (const window of ascending) {
      if (days <= window && !item.warnedDays.includes(window)) {
        warnings.push({ itemId: item.itemId, daysUntilExpiry: days, window });
        break; // only one warning per item per run
      }
    }
  }

  return { warnings, expiredItemIds, caseExpired };
}
