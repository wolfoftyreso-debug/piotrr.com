/**
 * Trade icons — now the ONE symbol language (docs/SYMBOLS.md), not a second
 * hand-drawn set. Per CLAUDE.md Appendix B §12, a thing that already has a
 * symbol never gets a second picture, so a trade renders the corresponding
 * symbol from the 110-glyph package via `Glyph`.
 *
 * The component keeps its old signature so call sites are unchanged.
 */
import { Glyph, type SymbolName } from "@/components/brand/symbols";

export type TradeIconProps = {
  slug: string;
  /** Rendered size in pixels. */
  size?: number;
  className?: string;
};

/** Trade slug → symbol in the package. */
const TRADE_SYMBOL: Record<string, SymbolName> = {
  welding: "svetsare",
  "industrial-fitting": "skiftnyckel",
  carpentry: "snickare",
  painting: "malare",
  tiling: "plattsattare",
  roofing: "taklaggare",
  concrete: "betong",
  demolition: "slagga",
  electrical: "elektriker",
  groundworks: "markarbete",
  "plumbing-hvac": "rormokare",
  "property-services": "ventilation",
  "steel-structures": "kran",
};

export function TradeIcon({ slug, size = 28, className }: TradeIconProps) {
  // Decorative: the trade is written next to it, so Glyph stays aria-hidden.
  return <Glyph name={TRADE_SYMBOL[slug] ?? "arbetslag"} size={size} className={className} />;
}
