import { describe, expect, it } from "vitest";
import {
  assertRfqTransition,
  canTransitionRfq,
  isTerminalRfqStatus,
} from "./domain";

describe("RFQ state machine", () => {
  it("follows new → qualified → dispatched → offers_in → accepted", () => {
    expect(canTransitionRfq("new", "qualified")).toBe(true);
    expect(canTransitionRfq("qualified", "dispatched")).toBe(true);
    expect(canTransitionRfq("dispatched", "offers_in")).toBe(true);
    expect(canTransitionRfq("offers_in", "accepted")).toBe(true);
  });

  it("allows lost/expired from every active state", () => {
    for (const from of ["new", "qualified", "dispatched", "offers_in"] as const) {
      expect(canTransitionRfq(from, "lost")).toBe(true);
      expect(canTransitionRfq(from, "expired")).toBe(true);
    }
  });

  it("rejects skipping the concierge steps", () => {
    expect(canTransitionRfq("new", "dispatched")).toBe(false);
    expect(canTransitionRfq("new", "accepted")).toBe(false);
    expect(canTransitionRfq("qualified", "accepted")).toBe(false);
    expect(() => assertRfqTransition("new", "accepted")).toThrow(
      /Invalid RFQ transition/,
    );
  });

  it("terminal states are terminal", () => {
    for (const status of ["accepted", "lost", "expired"] as const) {
      expect(isTerminalRfqStatus(status)).toBe(true);
      expect(canTransitionRfq(status, "new")).toBe(false);
    }
  });
});
