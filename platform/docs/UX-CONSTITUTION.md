# UX Constitution

The interaction doctrine for the whole product family. Clarity is the
aesthetic: depth, motion, typography and colour exist to make the system's
state understandable — never to show how much design we can add.

**The core loop, everywhere:** Action → immediate response → comprehensible
result → clear next step.

## The three laws

1. **The system must never make the user wonder whether something happened.**
2. **Show the outcome before the calculation.**
3. **Every screen must answer: Where am I? What is happening? What matters?
   What can I do? What happens if I do it?**

## The ten principles

1. **No action is silent.** Every interaction gives a noticeable, proportionate
   response *on the object itself* — `Sparar… → ✓ Sparat`, not a toast in a
   corner.
2. **Money is shown as money.** The human outcome first, in kronor (you pay
   X → you pay Y → you save Z/year). The percentage is secondary.
3. **Exchanges are visualised as exchanges.** You do X → this happens → you
   get Y.
4. **Information hierarchy is brutal.** The answer first, the explanation
   second, the calculation behind a disclosure — never a chart + six KPIs the
   reader must conclude from.
5. **Status is never ambiguous.** A strict status language, the same in every
   product — always **symbol *and* text**, never colour alone. (Implemented by
   `StatusBadge`; see the table below and `docs/SYMBOLS.md`.)
6. **Perceptual depth, not flatness.** Three levels — background → workspace →
   active object/dialog. What you work on comes forward; what ends settles
   back. Elevation is function.
7. **Motion explains cause and effect.** Sending moves the object toward
   *Sent*; expanding opens from the object you pressed. It builds a mental map.
8. **Errors speak plain language.** Never `Validation error: field required`.
   Say what is wrong and how to fix it, and separate what the user must do
   from what the system will retry.
9. **Confirmation is proportionate.** The size of the consequence sets the
   friction. A checkbox needs nothing; a 240 000 kr payment needs a deliberate
   click; permanent deletion needs more.
10. **Progressive disclosure, not simplification.** One system for the
    asphalt-layer, the restaurant manager and the CFO. Outcome on top; an
    expert can go all the way down to the raw data.

## The status language

Every case-state and item-status renders as symbol + localised text + semantic
colour, via `src/components/brand/StatusBadge.tsx`. Colour comes from the
`.badge.<status>` CSS; the symbol (below) adds the colour-independent channel.

| status | symbol (`docs/SYMBOLS.md`) | meaning |
|---|---|---|
| `verified` / `accepted` | `verifierad` / `klart` | granskad / genomförd |
| `in_review` | `pagar` | pågår |
| `approved` | `klart` | godkänd |
| `submitted` | `ladda-upp` | inlämnad |
| `missing` | `vantar` | saknas / väntar |
| `draft` | `skriv-andra` | utkast |
| `suspended` | `stopp-vanta` | pausad |
| `expired` | `tid` | utgången |
| `rejected` / `lost` | `problem` | avvisad |

## How this is built

- The doctrine is delivered visually, not as chrome: the public statement of
  it is a self-demonstrating page (each principle shown live). The binding,
  version-controlled source is this file.
- In the app: status symbols are `StatusBadge`; the icon language is the
  `Glyph` component over an inline sprite (`src/components/brand/symbols.tsx`,
  rendered once in the root layout). See `docs/SYMBOLS.md`.

When you build a screen, run it past the three laws and the five questions
before shipping it.
