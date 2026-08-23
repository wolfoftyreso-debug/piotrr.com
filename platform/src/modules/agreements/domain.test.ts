import { describe, expect, it } from "vitest";
import {
  assertAgreementTransition,
  canonicalDocument,
  documentHash,
  EMPTY_TERMS,
  fullySigned,
  InvalidAgreementTransition,
  openQuestions,
  readyToPropose,
  staleSignatures,
  type AgreementTerms,
} from "./domain";

const complete: AgreementTerms = {
  scope:
    "Montage av rostfria processrör i produktionshall B, inklusive svetsning, upphängning och täthetsprovning.",
  siteAddress: "Verkstadsgatan 4, Västerås",
  siteCountry: "SE",
  startDate: "2026-10-05",
  endDate: "2026-12-14",
  rateModel: "fixed",
  amountMinor: 98000000,
  currency: "SEK",
  headcount: 6,
  workingLanguage: "en",
  suppliedByBuyer: ["Ställning", "El på plats", "Bodar"],
  suppliedBySupplier: ["Verktyg", "Svetsutrustning", "Personlig skyddsutrustning"],
  paymentTerms: "30 dagar netto mot faktura vid godkänd delbesiktning.",
  delayTerms: "Vite 0,5 % av kontraktssumman per påbörjad förseningsvecka, max 7,5 %.",
  warrantyTerms: "Två års garanti på utfört arbete.",
};

const meta = { agreementId: "a-1", buyerName: "Bygg AB", supplierName: "Weld UAB", version: 1 };

describe("state machine", () => {
  it("allows the normal path", () => {
    expect(() => assertAgreementTransition("draft", "proposed")).not.toThrow();
    expect(() => assertAgreementTransition("proposed", "signed")).not.toThrow();
  });

  it("sends an edited proposal back to draft rather than forward", () => {
    expect(() => assertAgreementTransition("proposed", "draft")).not.toThrow();
  });

  it("refuses to reopen or cancel a signed agreement", () => {
    expect(() => assertAgreementTransition("signed", "draft")).toThrow(InvalidAgreementTransition);
    expect(() => assertAgreementTransition("signed", "cancelled")).toThrow(InvalidAgreementTransition);
    // The only way out of signed is a new document that replaces it.
    expect(() => assertAgreementTransition("signed", "superseded")).not.toThrow();
  });

  it("treats cancelled as terminal", () => {
    expect(() => assertAgreementTransition("cancelled", "draft")).toThrow(InvalidAgreementTransition);
  });
});

describe("open questions", () => {
  it("blocks on everything essential when the form is empty", () => {
    const q = openQuestions(EMPTY_TERMS);
    expect(q.some((x) => x.field === "scope" && x.severity === "blocking")).toBe(true);
    expect(q.some((x) => x.field === "siteCountry" && x.severity === "blocking")).toBe(true);
    expect(readyToPropose(EMPTY_TERMS)).toBe(false);
  });

  it("clears once the essentials are answered", () => {
    expect(readyToPropose(complete)).toBe(true);
    expect(openQuestions(complete).every((q) => q.severity === "advisory")).toBe(true);
  });

  it("asks who supplies what — the usual source of a dispute", () => {
    const bare = { ...complete, suppliedByBuyer: [], suppliedBySupplier: [] };
    const q = openQuestions(bare);
    expect(q.find((x) => x.field === "suppliedByBuyer")?.severity).toBe("blocking");
  });

  it("blocks an hourly job with no end date — an open-ended commitment", () => {
    const openEnded: AgreementTerms = { ...complete, rateModel: "hourly", endDate: null };
    const q = openQuestions(openEnded);
    expect(q.some((x) => x.field === "endDate" && x.severity === "blocking")).toBe(true);
    expect(readyToPropose(openEnded)).toBe(false);
  });

  it("only warns about a missing end date on a fixed price", () => {
    const noEnd: AgreementTerms = { ...complete, endDate: null };
    expect(readyToPropose(noEnd)).toBe(true);
  });

  it("rejects a one-line scope as too thin to be a scope", () => {
    const thin = { ...complete, scope: "Svetsning." };
    expect(readyToPropose(thin)).toBe(false);
  });
});

describe("document hashing", () => {
  it("is stable for the same terms", () => {
    const a = documentHash(canonicalDocument(complete, meta));
    const b = documentHash(canonicalDocument({ ...complete }, meta));
    expect(a).toBe(b);
  });

  it("does not depend on the order the terms object was built in", () => {
    const reordered = Object.fromEntries(
      Object.entries(complete).reverse(),
    ) as unknown as AgreementTerms;
    expect(documentHash(canonicalDocument(reordered, meta))).toBe(
      documentHash(canonicalDocument(complete, meta)),
    );
  });

  it("changes when any term changes", () => {
    const before = documentHash(canonicalDocument(complete, meta));
    const after = documentHash(
      canonicalDocument({ ...complete, amountMinor: 99000000 }, meta),
    );
    expect(after).not.toBe(before);
  });

  it("names both parties in the document", () => {
    const doc = canonicalDocument(complete, meta);
    expect(doc).toContain("Bygg AB");
    expect(doc).toContain("Weld UAB");
  });
});

describe("signatures", () => {
  const hash = documentHash(canonicalDocument(complete, meta));
  const other = documentHash(canonicalDocument({ ...complete, headcount: 7 }, meta));

  it("needs both parties on the same text", () => {
    expect(fullySigned([{ party: "buyer", documentHash: hash }], hash)).toBe(false);
    expect(
      fullySigned(
        [
          { party: "buyer", documentHash: hash },
          { party: "supplier", documentHash: hash },
        ],
        hash,
      ),
    ).toBe(true);
  });

  it("does not carry a signature over to an edited document", () => {
    const sigs = [
      { party: "buyer" as const, documentHash: other },
      { party: "supplier" as const, documentHash: hash },
    ];
    expect(fullySigned(sigs, hash)).toBe(false);
    expect(staleSignatures(sigs, hash)).toEqual([{ party: "buyer", documentHash: other }]);
  });

  it("does not let one party sign for both", () => {
    const sigs = [
      { party: "buyer" as const, documentHash: hash },
      { party: "buyer" as const, documentHash: hash },
    ];
    expect(fullySigned(sigs, hash)).toBe(false);
  });
});
