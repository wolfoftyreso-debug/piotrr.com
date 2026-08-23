/**
 * Country flags as geometry, not emoji.
 *
 * The regional-indicator emoji (U+1F1F1 U+1F1F9 for LT) fails worse than
 * merely looking inconsistent: **Windows ships no flag glyphs at all**,
 * so every Chrome and Edge user on Windows saw the bare letters "LT"
 * where a flag should be.
 * Roughly the whole Swedish buyer side of this marketplace is on Windows.
 *
 * Drawn at 3:2, the ratio LT, LV, EE and PL all use. SE and DK are 8:5
 * and 37:28 respectively; forcing them into 3:2 is the same compromise
 * every flag icon set makes, and at 20px nobody is measuring the hoist.
 */
export type CountryFlagProps = {
  /** ISO 3166-1 alpha-2, upper case. */
  code: string;
  /** Rendered width in pixels; height follows the 3:2 ratio. */
  size?: number;
  /** Accessible name. Pass the localized country name. */
  title?: string;
};

const W = 30;
const H = 20;

/** Three equal horizontal bands, top to bottom. */
function bands(colors: [string, string, string]) {
  return colors.map((fill, i) => (
    <rect key={i} x="0" y={(i * H) / 3} width={W} height={H / 3} fill={fill} />
  ));
}

/**
 * A Nordic cross: vertical bar set off-centre toward the hoist, which is
 * what makes it read as Scandinavian rather than as a plus sign.
 */
function nordicCross(field: string, cross: string) {
  return (
    <>
      <rect x="0" y="0" width={W} height={H} fill={field} />
      <rect x="0" y="8" width={W} height="4" fill={cross} />
      <rect x="9" y="0" width="4" height={H} fill={cross} />
    </>
  );
}

const FLAGS: Record<string, React.ReactNode> = {
  // Supplier countries.
  LT: bands(["#FDB913", "#006A44", "#C1272D"]),
  LV: (
    <>
      <rect x="0" y="0" width={W} height={H} fill="#9E3039" />
      <rect x="0" y="8" width={W} height="4" fill="#FFFFFF" />
    </>
  ),
  EE: bands(["#0072CE", "#000000", "#FFFFFF"]),
  PL: (
    <>
      <rect x="0" y="0" width={W} height={H / 2} fill="#FFFFFF" />
      <rect x="0" y={H / 2} width={W} height={H / 2} fill="#DC143C" />
    </>
  ),
  // Destination countries.
  SE: nordicCross("#006AA7", "#FECC00"),
  DK: nordicCross("#C8102E", "#FFFFFF"),
  DE: bands(["#000000", "#DD0000", "#FFCE00"]),
  NO: (
    <>
      <rect x="0" y="0" width={W} height={H} fill="#BA0C2F" />
      <rect x="0" y="7" width={W} height="6" fill="#FFFFFF" />
      <rect x="8" y="0" width="6" height={H} fill="#FFFFFF" />
      <rect x="0" y="8.5" width={W} height="3" fill="#00205B" />
      <rect x="9.5" y="0" width="3" height={H} fill="#00205B" />
    </>
  ),
};

export function CountryFlag({ code, size = 20, title }: CountryFlagProps) {
  const art = FLAGS[code.toUpperCase()];

  // No flag for this code: show the code itself rather than an empty box,
  // which is at least as informative as a flag nobody recognises.
  if (!art) {
    return (
      <span aria-label={title ?? code} title={title ?? code}>
        {code.toUpperCase()}
      </span>
    );
  }

  return (
    <svg
      width={size}
      height={(size * H) / W}
      viewBox={`0 0 ${W} ${H}`}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      style={{ borderRadius: 2, display: "inline-block", verticalAlign: "middle" }}
    >
      {title ? <title>{title}</title> : null}
      {art}
      {/* A hairline so white and yellow fields keep an edge on a white card. */}
      <rect
        x="0.25"
        y="0.25"
        width={W - 0.5}
        height={H - 0.5}
        fill="none"
        stroke="rgba(0,0,0,0.18)"
        strokeWidth="0.5"
        rx="1.5"
      />
    </svg>
  );
}
