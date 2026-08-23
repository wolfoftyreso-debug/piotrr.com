import { describe, expect, it } from "vitest";
import {
  assertCaseTransition,
  badgeVisible,
  canTransitionCase,
  canTransitionItem,
  caseReadyForVerified,
  runExpiryCheck,
  type ExpiryInput,
} from "./domain";

describe("verification case state machine", () => {
  it("follows draft → in_review → verified", () => {
    expect(canTransitionCase("draft", "in_review")).toBe(true);
    expect(canTransitionCase("in_review", "verified")).toBe(true);
  });

  it("verified can be suspended or expired", () => {
    expect(canTransitionCase("verified", "suspended")).toBe(true);
    expect(canTransitionCase("verified", "expired")).toBe(true);
  });

  it("expired and suspended cases can re-enter review", () => {
    expect(canTransitionCase("expired", "in_review")).toBe(true);
    expect(canTransitionCase("suspended", "in_review")).toBe(true);
  });

  it("rejects illegal transitions", () => {
    expect(canTransitionCase("draft", "verified")).toBe(false);
    expect(canTransitionCase("expired", "verified")).toBe(false);
    expect(() => assertCaseTransition("draft", "verified")).toThrow(
      /Invalid case transition/,
    );
  });

  it("the badge derives ONLY from case state", () => {
    expect(badgeVisible("verified")).toBe(true);
    for (const state of ["draft", "in_review", "suspended", "expired"] as const) {
      expect(badgeVisible(state)).toBe(false);
    }
  });

  it("a case is ready for verified only when every item is approved", () => {
    expect(caseReadyForVerified([])).toBe(false);
    expect(
      caseReadyForVerified([{ status: "approved" }, { status: "in_review" }]),
    ).toBe(false);
    expect(
      caseReadyForVerified([{ status: "approved" }, { status: "approved" }]),
    ).toBe(true);
  });
});

describe("verification item state machine", () => {
  it("follows missing → submitted → in_review → approved", () => {
    expect(canTransitionItem("missing", "submitted")).toBe(true);
    expect(canTransitionItem("submitted", "in_review")).toBe(true);
    expect(canTransitionItem("in_review", "approved")).toBe(true);
    expect(canTransitionItem("in_review", "rejected")).toBe(true);
  });

  it("rejected evidence can be resubmitted; expired items too", () => {
    expect(canTransitionItem("rejected", "submitted")).toBe(true);
    expect(canTransitionItem("expired", "submitted")).toBe(true);
  });

  it("rejects illegal transitions", () => {
    expect(canTransitionItem("missing", "approved")).toBe(false);
    expect(canTransitionItem("approved", "rejected")).toBe(false);
  });
});

describe("expiry engine (simulated clock)", () => {
  const NOW = new Date("2026-07-21T02:00:00Z");
  const inDays = (n: number) =>
    new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

  const approvedItem = (
    id: string,
    validInDays: number,
    overrides: Partial<ExpiryInput> = {},
  ): ExpiryInput => ({
    itemId: id,
    status: "approved",
    validUntil: inDays(validInDays),
    critical: true,
    warnedDays: [],
    ...overrides,
  });

  it("flags documents expiring within 30/14/3 days exactly once per window", () => {
    const result = runExpiryCheck(
      [approvedItem("a", 29), approvedItem("b", 13), approvedItem("c", 2)],
      NOW,
    );
    expect(result.warnings).toEqual([
      { itemId: "a", daysUntilExpiry: 29, window: 30 },
      { itemId: "b", daysUntilExpiry: 13, window: 14 },
      { itemId: "c", daysUntilExpiry: 2, window: 3 },
    ]);
    expect(result.expiredItemIds).toEqual([]);
    expect(result.caseExpired).toBe(false);
  });

  it("does not re-warn a window that already fired", () => {
    const result = runExpiryCheck(
      [approvedItem("a", 29, { warnedDays: [30] })],
      NOW,
    );
    expect(result.warnings).toEqual([]);
  });

  it("fires the tighter window when the clock advances", () => {
    const result = runExpiryCheck(
      [approvedItem("a", 10, { warnedDays: [30] })],
      NOW,
    );
    expect(result.warnings).toEqual([
      { itemId: "a", daysUntilExpiry: 10, window: 14 },
    ]);
  });

  it("a lapsed critical document expires the case (badge flips automatically)", () => {
    const result = runExpiryCheck([approvedItem("a", -1)], NOW);
    expect(result.expiredItemIds).toEqual(["a"]);
    expect(result.caseExpired).toBe(true);
  });

  it("a lapsed non-critical document expires the item but not the case", () => {
    const result = runExpiryCheck(
      [approvedItem("a", -1, { critical: false }), approvedItem("b", 60)],
      NOW,
    );
    expect(result.expiredItemIds).toEqual(["a"]);
    expect(result.caseExpired).toBe(false);
  });

  it("ignores items that are not approved or have no validity date", () => {
    const result = runExpiryCheck(
      [
        approvedItem("a", -5, { status: "submitted" }),
        approvedItem("b", -5, { validUntil: null }),
      ],
      NOW,
    );
    expect(result.expiredItemIds).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
