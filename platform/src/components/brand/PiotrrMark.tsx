import { brand } from "@/lib/brand";

/**
 * The Piotrr mark — a compact, geometric P for the favicon, app icon and
 * tight chrome. The counter is a rounded form opening to the right: two
 * paths meeting and pointing onward ("ready to deliver"), rather than a
 * literal bridge, gear or handshake. Legible down to 16×16.
 *
 * Colour comes from `currentColor` (default cobalt) so a single glyph serves
 * every context: mono, inverse, on light or dark.
 */
export function PiotrrMark({
  size = 32,
  color = "var(--piotrr-cobalt)",
  title = brand.name,
  className,
}: {
  size?: number;
  color?: string;
  title?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label={title}
      className={className}
      style={{ color }}
    >
      {/* P glyph with a rounded, right-opening counter (even-odd cut). */}
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7 4h9.5a8 8 0 0 1 0 16h-5.5v8H7V4Zm4 5v6h5.5a3 3 0 0 0 0-6H11Z"
      />
    </svg>
  );
}

export default PiotrrMark;
