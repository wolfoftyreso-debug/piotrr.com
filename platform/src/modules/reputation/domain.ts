/**
 * Reputation: ratings and merits (Appendix B decision 10).
 *
 * This module deliberately sits *beside* verification, never inside it.
 * Verification answers one legal question — may this company work in that
 * country — and stays binary. Reputation answers a commercial one: what
 * has this company actually done, and what did buyers think. Mixing the
 * two would let a 4.2-star average read as "partly compliant", which is
 * exactly the misreading the binary badge exists to prevent.
 *
 * Three hard rules encoded here:
 *  1. A rating can only come from a recorded deal — no drive-by reviews.
 *  2. An average is withheld until MIN_REVIEWS_FOR_AVERAGE, because
 *     "5.0 out of 1" is noise presented as signal.
 *  3. Every merit carries its provenance. A fact we checked and a fact the
 *     company typed in are never rendered as the same kind of thing.
 */

export const RATING_DIMENSIONS = [
  "workmanship",
  "schedule",
  "communication",
  "documentation",
] as const;
export type RatingDimension = (typeof RATING_DIMENSIONS)[number];

export type RatingScores = Record<RatingDimension, number>;

/** Below this, we show the count and the individual reviews but no average. */
export const MIN_REVIEWS_FOR_AVERAGE = 3;

export class InvalidRatingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRatingError";
  }
}

/** 1–5 integers on every dimension. Half-stars invite false precision. */
export function assertValidScores(scores: Partial<RatingScores>): RatingScores {
  const out = {} as RatingScores;
  for (const dim of RATING_DIMENSIONS) {
    const v = scores[dim];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 5) {
      throw new InvalidRatingError(`${dim} must be a whole number from 1 to 5`);
    }
    out[dim] = v;
  }
  return out;
}

export interface ReviewLike {
  scores: RatingScores;
  publishedAt: Date | null;
}

export interface Aggregate {
  /** Published reviews counted. */
  count: number;
  /** Null until MIN_REVIEWS_FOR_AVERAGE — withheld, not zero. */
  overall: number | null;
  byDimension: Record<RatingDimension, number> | null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function aggregate(reviews: ReviewLike[]): Aggregate {
  const published = reviews.filter((r) => r.publishedAt !== null);
  const count = published.length;

  if (count < MIN_REVIEWS_FOR_AVERAGE) {
    return { count, overall: null, byDimension: null };
  }

  const byDimension = {} as Record<RatingDimension, number>;
  for (const dim of RATING_DIMENSIONS) {
    const sum = published.reduce((acc, r) => acc + r.scores[dim], 0);
    byDimension[dim] = round1(sum / count);
  }
  const overall = round1(
    RATING_DIMENSIONS.reduce((acc, d) => acc + byDimension[d], 0) /
      RATING_DIMENSIONS.length,
  );
  return { count, overall, byDimension };
}

/* ------------------------------------------------------------------ */
/* Merits                                                              */
/* ------------------------------------------------------------------ */

/**
 * Where a merit comes from. This is the whole point of the type: a buyer
 * must be able to tell "we opened the certificate" from "the company
 * wrote ISO 9001 in a text box".
 */
export type MeritSource =
  /** Checked by Piotrr ops against an original document. */
  | "verified"
  /** Computed from our own records — deals closed here, reviews here. */
  | "platform"
  /** Stated by the company, never checked. */
  | "stated";

export type MeritKind =
  | "years_in_business"
  | "completed_deals"
  | "certification"
  | "award"
  | "reference_projects";

export interface Merit {
  kind: MeritKind;
  source: MeritSource;
  /** Short, already human-readable; the UI localises the surrounding text. */
  label: string;
  /** Sort weight — higher first. Verified merits outrank stated ones. */
  weight: number;
}

export interface MeritInput {
  yearFounded: number | null;
  certifications: string[];
  awards: string[];
  /** Deals recorded on this platform. */
  completedDeals: number;
  /** Reference projects ops collected and checked. */
  checkedReferences: number;
  now: Date;
}

/**
 * Build the merit list. Nothing here is a score: every entry is a
 * countable fact with a source, and the UI groups by that source.
 */
export function merits(input: MeritInput): Merit[] {
  const out: Merit[] = [];

  if (input.yearFounded && input.yearFounded > 1800) {
    const years = input.now.getUTCFullYear() - input.yearFounded;
    // Under two years is not a merit — stating it would flatter a newcomer.
    if (years >= 2) {
      out.push({
        kind: "years_in_business",
        source: "stated",
        label: `${years} år i branschen`,
        weight: Math.min(years, 40),
      });
    }
  }

  if (input.completedDeals > 0) {
    out.push({
      kind: "completed_deals",
      source: "platform",
      label:
        input.completedDeals === 1
          ? "1 genomförd affär via Piotrr"
          : `${input.completedDeals} genomförda affärer via Piotrr`,
      weight: 100 + input.completedDeals,
    });
  }

  if (input.checkedReferences > 0) {
    out.push({
      kind: "reference_projects",
      source: "verified",
      label: `${input.checkedReferences} kontrollerade referensprojekt`,
      weight: 200 + input.checkedReferences,
    });
  }

  for (const cert of input.certifications) {
    out.push({ kind: "certification", source: "stated", label: cert, weight: 50 });
  }
  for (const award of input.awards) {
    out.push({ kind: "award", source: "stated", label: award, weight: 40 });
  }

  return out.sort((a, b) => b.weight - a.weight);
}

/** Group merits by provenance so the UI cannot accidentally blend them. */
export function meritsBySource(list: Merit[]): Record<MeritSource, Merit[]> {
  return {
    verified: list.filter((m) => m.source === "verified"),
    platform: list.filter((m) => m.source === "platform"),
    stated: list.filter((m) => m.source === "stated"),
  };
}
