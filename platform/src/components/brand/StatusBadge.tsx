import { Glyph, type SymbolName } from "./symbols";

/**
 * The status language (see docs/UX-CONSTITUTION.md §5): a status is never
 * ambiguous — always symbol **and** text, never colour alone. The badge's
 * colour still comes from the `.badge.<status>` CSS; the symbol adds the
 * second, colour-independent channel and inherits that same colour via
 * `currentColor`.
 *
 * Covers every case-state and item-status the platform uses. Unknown values
 * render as text only, so this can never throw on a new status.
 */
const STATUS_SYMBOL: Record<string, SymbolName> = {
  // verification case states
  draft: "skriv-andra",
  in_review: "pagar",
  verified: "verifierad",
  suspended: "stopp-vanta",
  expired: "tid",
  // verification item statuses
  missing: "vantar",
  submitted: "ladda-upp",
  approved: "klart",
  rejected: "problem",
  // deal / offer outcomes (mapped to the shared language)
  accepted: "klart",
  lost: "problem",
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  /** The status value — also the `.badge` colour class (verified, expired, …). */
  status: string;
  /** The already-localised label text (never build copy here). */
  label: string;
  className?: string;
}) {
  const symbol = STATUS_SYMBOL[status];
  return (
    <span className={`badge ${status}${className ? ` ${className}` : ""}`}>
      {symbol ? <Glyph name={symbol} /> : null}
      {label}
    </span>
  );
}
