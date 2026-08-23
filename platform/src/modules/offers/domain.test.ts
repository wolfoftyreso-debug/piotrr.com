import { describe, expect, it } from "vitest";
import {
  buildVerificationSnapshot,
  canTransitionOffer,
  type SnapshotInputFacts,
  type WorkerCertInput,
} from "./domain";

describe("offer state machine", () => {
  it("submitted can be withdrawn, accepted, rejected or expired", () => {
    for (const to of ["withdrawn", "accepted", "rejected", "expired"] as const) {
      expect(canTransitionOffer("submitted", to)).toBe(true);
    }
  });

  it("decisions are final", () => {
    for (const from of ["withdrawn", "accepted", "rejected", "expired"] as const) {
      expect(canTransitionOffer(from, "submitted")).toBe(false);
      expect(canTransitionOffer(from, "accepted")).toBe(false);
    }
  });
});

describe("verification snapshot freezing (mandatory, Section 8.4)", () => {
  const NOW = new Date("2026-07-24T10:00:00Z");

  const facts = (): SnapshotInputFacts => ({
    verified: true,
    verifiedSince: new Date("2026-06-01T00:00:00Z"),
    facts: [
      {
        key: "f_skatt",
        nameEn: "F-skatt",
        scope: "company",
        validUntil: new Date("2027-01-01T00:00:00Z"),
      },
      {
        key: "a1_certificate",
        nameEn: "A1",
        scope: "worker",
        validUntil: new Date("2026-12-01T00:00:00Z"),
        workerCount: 2,
      },
    ],
  });

  const team = (): WorkerCertInput[] => [
    {
      workerId: "w1",
      workerName: "Jonas",
      tradeRole: "welder",
      approvedCerts: [
        {
          requirementKey: "welder_qualifications",
          validUntil: new Date("2026-11-01T00:00:00Z"),
        },
      ],
    },
  ];

  it("captures company verification, facts and team certs with a timestamp", () => {
    const snapshot = buildVerificationSnapshot(facts(), team(), NOW);
    expect(snapshot.frozenAt).toBe("2026-07-24T10:00:00.000Z");
    expect(snapshot.companyVerified).toBe(true);
    expect(snapshot.facts).toHaveLength(2);
    expect(snapshot.facts[1]?.workerCount).toBe(2);
    expect(snapshot.team[0]?.approvedCerts[0]?.requirementKey).toBe(
      "welder_qualifications",
    );
  });

  it("is FROZEN: mutating the inputs afterwards never changes the snapshot", () => {
    const inputFacts = facts();
    const inputTeam = team();
    const snapshot = buildVerificationSnapshot(inputFacts, inputTeam, NOW);
    const before = JSON.stringify(snapshot);

    // Verification changes AFTER submission (badge lost, certs expired,
    // team edited) — exactly what happens in the real world
    inputFacts.verified = false;
    inputFacts.facts.pop();
    inputFacts.facts[0]!.validUntil = new Date("2020-01-01T00:00:00Z");
    inputTeam[0]!.approvedCerts.pop();
    inputTeam.pop();

    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it("serializes to plain JSON (storable in jsonb, no Date objects)", () => {
    const snapshot = buildVerificationSnapshot(facts(), team(), NOW);
    const roundTripped = JSON.parse(JSON.stringify(snapshot));
    expect(roundTripped).toEqual(snapshot);
  });

  it("represents an unverified company honestly", () => {
    const snapshot = buildVerificationSnapshot(
      { verified: false, verifiedSince: null, facts: [] },
      [],
      NOW,
    );
    expect(snapshot.companyVerified).toBe(false);
    expect(snapshot.verifiedSince).toBeNull();
    expect(snapshot.facts).toHaveLength(0);
  });
});
