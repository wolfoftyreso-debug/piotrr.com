/** Money is { amount_minor, currency: EUR|SEK } — no FX (Section 3) */
export function formatMinor(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  return new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency,
    maximumFractionDigits: major % 1 === 0 ? 0 : 2,
  }).format(major);
}

/**
 * Currencies the platform records. No FX conversion (Section 3) — an amount
 * is always stored and shown in the currency it was agreed in.
 */
export const CURRENCIES = ["EUR", "SEK", "DKK", "NOK", "PLN", "CZK"] as const;
export type Currency = (typeof CURRENCIES)[number];
