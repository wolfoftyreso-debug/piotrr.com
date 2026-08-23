import { brand } from "@/lib/brand";

/**
 * The PIOTRR wordmark — a typographic treatment of the product name, always
 * rendered from `brand.wordmark` so it can never drift or be misspelled.
 *
 * The two closing R's are the signature: the space between them is pulled in
 * a touch (never a colour change, never a symbol between letters). The mark
 * never wraps.
 *
 * Variants:
 *   default          ink on light
 *   inverse          paper on dark
 *   compact          tighter, for dense chrome
 *   with-descriptor  wordmark above a subordinate descriptor line
 */
export type WordmarkVariant =
  | "default"
  | "inverse"
  | "compact"
  | "with-descriptor";

const COLORS: Record<"default" | "inverse" | "compact", string> = {
  default: "var(--piotrr-ink)",
  inverse: "var(--piotrr-paper)",
  compact: "var(--piotrr-ink)",
};

export function PiotrrWordmark({
  variant = "default",
  color,
  className,
  style,
}: {
  variant?: WordmarkVariant;
  /** Override the colour, e.g. "var(--piotrr-cobalt)" for the mono-cobalt lockup. */
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const base = variant === "inverse" ? "inverse" : "default";
  const fill = color ?? COLORS[variant === "compact" ? "compact" : base];
  const word = brand.wordmark; // "PIOTRR"
  const head = word.slice(0, word.length - 2); // "PIOT"
  const tail = word.slice(word.length - 2); // "RR" — the signature

  return (
    <span
      className={className}
      aria-label={brand.name}
      style={{
        display: "inline-flex",
        flexDirection: variant === "with-descriptor" ? "column" : "row",
        alignItems: variant === "with-descriptor" ? "flex-start" : "baseline",
        gap: variant === "with-descriptor" ? "0.25rem" : undefined,
        lineHeight: 1,
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          whiteSpace: "nowrap",
          fontWeight: 700,
          letterSpacing: variant === "compact" ? "-0.02em" : "-0.01em",
          color: fill,
          fontFamily:
            'var(--font-brand, "Geist", "Inter", system-ui, sans-serif)',
        }}
      >
        {head}
        {/* The R-R signature: the pair tightened, same colour as the rest. */}
        <span style={{ letterSpacing: "-0.06em" }}>{tail}</span>
      </span>
      {variant === "with-descriptor" && (
        <span
          aria-hidden="true"
          style={{
            fontSize: "0.5em",
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--piotrr-steel)",
            whiteSpace: "nowrap",
          }}
        >
          {brand.tagline}
        </span>
      )}
    </span>
  );
}

export default PiotrrWordmark;
