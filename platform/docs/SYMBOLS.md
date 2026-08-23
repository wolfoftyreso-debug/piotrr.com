# Piotrr symbol language (v2)

A universal construction & machine icon language — **110 symbols**. One
picture, one meaning: the same symbol means the same thing everywhere (search,
offers, contracts, receipts). The symbols are the interface; text beside them
is always optional, so someone who does not read Swedish still understands each
step.

## Design rules

- **48-pixel grid** (`0 0 48 48` viewBox), **2.6px stroke**, round caps and
  joins, no sharp corners — the clarity of a picture book without being
  childish.
- Two-tone: an ink-blue stroke with a soft-blue fill. In the app both resolve
  from **`currentColor`** (the fill as a translucent tint), so a symbol takes
  the colour of the text around it — which is exactly how the status language
  stays symbol + text + semantic colour (see `docs/UX-CONSTITUTION.md` §5).

## Using symbols in the app

```tsx
import { Glyph } from "@/components/brand/symbols";      // one symbol
import { StatusBadge } from "@/components/brand/StatusBadge"; // status = symbol + text

<Glyph name="verifierad" />
<Glyph name="forvar" size={28} className="is-ok" />
<StatusBadge status={caseState} label={t(caseState)} />  // never build copy here
```

- The component is named **`Glyph`** (not `Symbol`, to avoid shadowing the JS
  global). `SymbolName` is the typed union of all 110 slugs; the compiler
  rejects a name that does not exist.
- `SymbolSprite` is rendered once in `src/app/[locale]/layout.tsx`; every
  `Glyph` references it via `<use>`. Do not render the sprite more than once.
- Colour a symbol by setting `color` (or a `.is-ok` / `.is-wait` / … helper);
  it never carries a hard-coded colour of its own.

## The set

110 symbols across 12 categories: people & trades, tools, protection,
machines, money & contracts (open banknote exchanges: `forfragan`, `pris`,
`sedel`, `utbyte`, `avtal`, `forvar`, …), status & conversation (`verifierad`,
`vantar`, `pagar`, `klart`, `problem`, …), vehicles, buildings, materials,
more trades, arrows & direction, and actions.

The canonical source SVGs, `index.json` and the designed reference sheet
(`gallery.html`) live in the **`piotrr.com`** repository under `symbols/`. The
app embeds a generated, theme-adaptive sprite of the same set. Regenerate the
sprite from those sources; never hand-edit it.

**Rule:** look a symbol up by meaning in the set; never draw a second picture
for a thing that already has one.
