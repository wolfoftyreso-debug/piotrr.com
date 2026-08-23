/** RFQ lifecycle (Section 5/M3):
 * new → qualified → dispatched → offers_in → accepted | lost | expired */

export type RfqStatus =
  | "new"
  | "qualified"
  | "dispatched"
  | "offers_in"
  | "accepted"
  | "lost"
  | "expired";

const TRANSITIONS: Record<RfqStatus, RfqStatus[]> = {
  new: ["qualified", "lost", "expired"],
  qualified: ["dispatched", "lost", "expired"],
  dispatched: ["offers_in", "lost", "expired"],
  offers_in: ["accepted", "lost", "expired"],
  accepted: [],
  lost: [],
  expired: [],
};

export function canTransitionRfq(from: RfqStatus, to: RfqStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertRfqTransition(from: RfqStatus, to: RfqStatus): void {
  if (!canTransitionRfq(from, to)) {
    throw new Error(`Invalid RFQ transition: ${from} -> ${to}`);
  }
}

export function isTerminalRfqStatus(status: RfqStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
