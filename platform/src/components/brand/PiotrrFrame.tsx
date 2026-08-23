import { brand } from "@/lib/brand";
import { PiotrrWordmark } from "./PiotrrWordmark";

/**
 * Piotrr Frame — the controlled visual encapsulation of the name: the PIOTRR
 * wordmark inside a thin precision border, generous horizontal breathing
 * room, softly rounded corners, no decorative icons. An optional short
 * descriptor sits after a thin vertical divider.
 *
 * Use it on the surfaces that represent the brand deliberately — sign-in,
 * onboarding, marketing headers, document and report covers, share images,
 * verification evidence. In ordinary product navigation the bare wordmark is
 * enough; do not wrap it in the frame everywhere.
 */
export function PiotrrFrame({
  descriptor,
  inverse = false,
  height = 42,
  className,
  style,
}: {
  /** Optional short descriptor after the divider (defaults to the tagline when `true`). */
  descriptor?: string | boolean;
  inverse?: boolean;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const text =
    descriptor === true
      ? brand.tagline
      : typeof descriptor === "string"
        ? descriptor
        : null;

  return (
    <div
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.75rem",
        height,
        padding: "0 16px",
        border: `1px solid ${inverse ? "rgba(246,244,239,0.28)" : "var(--piotrr-line)"}`,
        borderRadius: 11,
        background: inverse ? "var(--piotrr-ink)" : "transparent",
        ...style,
      }}
    >
      <PiotrrWordmark
        variant={inverse ? "inverse" : "default"}
        style={{ fontSize: Math.round(height * 0.42) }}
      />
      {text && (
        <>
          <span
            aria-hidden="true"
            style={{
              width: 1,
              alignSelf: "stretch",
              margin: "9px 0",
              background: inverse
                ? "rgba(246,244,239,0.28)"
                : "var(--piotrr-line)",
            }}
          />
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.02em",
              color: inverse ? "rgba(246,244,239,0.72)" : "var(--piotrr-steel)",
              whiteSpace: "nowrap",
            }}
          >
            {text}
          </span>
        </>
      )}
    </div>
  );
}

export default PiotrrFrame;
