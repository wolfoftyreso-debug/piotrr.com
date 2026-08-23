import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No emoji on the product surface.
 *
 * The trade tiles shipped with emoji as their icons, and the supplier
 * directory shipped emoji flags. Neither is an image: they are font
 * glyphs the operating system draws, so the page looked like Apple's
 * artwork on a Mac and Google's on Android — and **Windows ships no flag
 * glyphs at all**, so Windows users saw the bare letters "LT" where a
 * flag belonged. That is most of the Swedish buyer side of this
 * marketplace.
 *
 * Real icons are `src/components/trade-icon.tsx` and
 * `src/components/country-flag.tsx`: SVG geometry, one grid, one stroke
 * weight, `currentColor`.
 *
 * This test is the guard. It covers what ships to a person — components,
 * pages, the eight translation files, and the text of outgoing email. It
 * does NOT cover `docs/` or the console output of the test scripts;
 * those are read by us, in a terminal, and a check mark in a log is not a
 * brand problem.
 *
 * The rule is a Unicode property, not a hand-written range — a
 * hand-written range is how the previous sweep missed things.
 *
 * `Extended_Pictographic` alone is not enough, and finding that out is
 * why this file exists. A flag emoji is a pair of REGIONAL INDICATOR
 * letters (U+1F1F1 U+1F1F9 for LT), and those are **not**
 * Extended_Pictographic. A checker built on that property alone reports
 * "no emoji" on a page full of flags — which is precisely the case that
 * started all this. Keycap sequences (U+20E3) and the emoji variation
 * selector (U+FE0F) are in for the same reason.
 */

/** Typographic marks, not pictures. Deliberately allowed. */
const ALLOWED = new Set([
  "✓", // U+2713 check mark — used in the verified badge
  "→",
  "←",
  "↔",
  "·",
  "—",
  "–",
]);

const PICTOGRAPHIC =
  /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{FE0F}|\u{20E3}/u;

const ROOTS = [
  "src/app",
  "src/components",
  "src/messages",
  "src/modules",
  "src/jobs", // email subjects and bodies reach a person's inbox
  "src/lib",
];

const EXTENSIONS = [".ts", ".tsx", ".json", ".css"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (EXTENSIONS.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

describe("no emoji on the product surface", () => {
  const files = ROOTS.flatMap((r) => walk(join(process.cwd(), r)));

  it("is looking at the files it thinks it is", () => {
    // A guard that scans nothing passes forever.
    expect(files.length).toBeGreaterThan(80);
    expect(files.some((f) => f.endsWith("messages/sv.json"))).toBe(true);
    expect(files.some((f) => f.includes("components"))).toBe(true);
  });

  it("would catch an emoji if one were there", () => {
    // The detector itself, tested — and written from codepoints so this
    // file does not trip its own check.
    const wrench = String.fromCodePoint(0x1f527);
    const flagLT = String.fromCodePoint(0x1f1f1, 0x1f1f9);
    const keycap = "3" + String.fromCodePoint(0xfe0f, 0x20e3);
    expect(PICTOGRAPHIC.test(wrench), "a pictograph").toBe(true);
    expect(PICTOGRAPHIC.test(flagLT), "a regional-indicator flag").toBe(true);
    expect(PICTOGRAPHIC.test(keycap), "a keycap sequence").toBe(true);
    expect(PICTOGRAPHIC.test("plain text"), "ordinary text").toBe(false);
    expect(PICTOGRAPHIC.test("✓ → ·"), "typographic marks").toBe(false);
  });

  it("finds none in components, pages, translations or email text", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!PICTOGRAPHIC.test(source)) continue;
      source.split("\n").forEach((line, index) => {
        for (const char of line) {
          if (!PICTOGRAPHIC.test(char) || ALLOWED.has(char)) continue;
          const point = char.codePointAt(0)!.toString(16).toUpperCase();
          offenders.push(
            `${file.replace(process.cwd() + "/", "")}:${index + 1} U+${point} ${char}`,
          );
        }
      });
    }
    expect(
      offenders,
      "emoji on the product surface — use src/components/trade-icon.tsx or country-flag.tsx",
    ).toEqual([]);
  });
});
