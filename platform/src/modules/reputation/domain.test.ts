import { describe, expect, it } from "vitest";
import {
  aggregate,
  assertValidScores,
  InvalidRatingError,
  merits,
  meritsBySource,
  MIN_REVIEWS_FOR_AVERAGE,
  type RatingScores,
} from "./domain";

const good: RatingScores = {
  workmanship: 5,
  schedule: 4,
  communication: 4,
  documentation: 5,
};
const review = (s: RatingScores, published = true) => ({
  scores: s,
  publishedAt: published ? new Date("2026-08-01") : null,
});

describe("score validation", () => {
  it("accepts whole numbers 1–5 on every dimension", () => {
    expect(assertValidScores(good)).toEqual(good);
  });

  it("rejects a missing dimension rather than defaulting it", () => {
    expect(() => assertValidScores({ workmanship: 5 })).toThrow(InvalidRatingError);
  });

  it("rejects out-of-range and fractional scores", () => {
    expect(() => assertValidScores({ ...good, schedule: 0 })).toThrow(InvalidRatingError);
    expect(() => assertValidScores({ ...good, schedule: 6 })).toThrow(InvalidRatingError);
    // Half-stars invite false precision the underlying data cannot support.
    expect(() => assertValidScores({ ...good, schedule: 4.5 })).toThrow(InvalidRatingError);
  });
});

describe("aggregate", () => {
  it("withholds the average below the threshold — never shows 5.0 out of one", () => {
    const a = aggregate([review(good)]);
    expect(a.count).toBe(1);
    expect(a.overall).toBeNull();
    expect(a.byDimension).toBeNull();
  });

  it("publishes an average once there are enough reviews", () => {
    const a = aggregate(Array.from({ length: MIN_REVIEWS_FOR_AVERAGE }, () => review(good)));
    expect(a.count).toBe(MIN_REVIEWS_FOR_AVERAGE);
    expect(a.overall).toBe(4.5);
    expect(a.byDimension?.workmanship).toBe(5);
    expect(a.byDimension?.schedule).toBe(4);
  });

  it("counts only published reviews", () => {
    const a = aggregate([review(good), review(good), review(good, false)]);
    expect(a.count).toBe(2);
    expect(a.overall).toBeNull();
  });

  it("returns a zero count, not a zero score, for a company with no reviews", () => {
    const a = aggregate([]);
    expect(a.count).toBe(0);
    expect(a.overall).toBeNull();
  });
});

describe("merits", () => {
  const now = new Date("2026-08-09");
  const base = {
    yearFounded: null,
    certifications: [],
    awards: [],
    completedDeals: 0,
    checkedReferences: 0,
    now,
  };

  it("states years in business from the founding year", () => {
    const m = merits({ ...base, yearFounded: 2009 });
    expect(m[0]?.label).toBe("17 år i branschen");
  });

  it("does not flatter a company under two years old", () => {
    expect(merits({ ...base, yearFounded: 2025 })).toEqual([]);
  });

  it("marks platform records, checked facts and claims apart", () => {
    const grouped = meritsBySource(
      merits({
        ...base,
        yearFounded: 2010,
        certifications: ["ISO 9001"],
        awards: ["Gazele Biznesu 2023"],
        completedDeals: 4,
        checkedReferences: 2,
      }),
    );
    expect(grouped.verified.map((m) => m.kind)).toEqual(["reference_projects"]);
    expect(grouped.platform.map((m) => m.kind)).toEqual(["completed_deals"]);
    // A certificate the company typed in is a claim, never a checked fact.
    expect(grouped.stated.map((m) => m.kind).sort()).toEqual([
      "award",
      "certification",
      "years_in_business",
    ]);
  });

  it("ranks checked facts above platform records above claims", () => {
    const m = merits({
      ...base,
      yearFounded: 2010,
      certifications: ["ISO 9001"],
      completedDeals: 4,
      checkedReferences: 2,
    });
    expect(m[0]?.source).toBe("verified");
    expect(m[1]?.source).toBe("platform");
  });

  it("says one deal in the singular", () => {
    const m = merits({ ...base, completedDeals: 1 });
    expect(m[0]?.label).toBe("1 genomförd affär via Piotrr");
  });
});
