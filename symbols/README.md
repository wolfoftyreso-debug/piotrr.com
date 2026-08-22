# Piotrr Symbolspråk (v2)

A universal construction & machine icon language for Piotrr — **110 symbols**.
One picture, one meaning: the same symbol means the same thing everywhere in
the system (search, offers, contracts, receipts). The symbols are not
decoration — they *are* the interface. Text beside them is always optional, so
someone who does not read Swedish (or does not read at all) still understands
every step.

## Design rules

- **48-pixel grid**, drawn on a `0 0 48 48` viewBox (files render at 52px with
  a 2px safe margin).
- **2.6px stroke**, round caps and joins, no sharp corners — "the clarity of a
  picture book, without being childish."
- **Ink-blue `#2e4660`** stroke with a **soft-blue `#d8e5f1`** fill as the
  two-tone ("mjuk blå + gråskala"). These sit inside the Piotrr palette
  (Cobalt is still the interactive signal colour; these symbols are content).
- Every symbol is a self-contained SVG — inline it, or reference it with
  `<img src="symbols/verifierad.svg">`.

## Contents

- `*.svg` — the 110 symbols, one file per symbol, named by slug.
- `index.json` — `{ name, slug, category, file }` for every symbol.
- `gallery.html` — the original designed reference sheet (open it to browse the
  full set with its usage stories: the whole deal as a picture narrative, the
  supplier card readable without text, the open banknote exchange).

## Categories

| Count | Category |
|------:|----------|
| 11 | Människor & yrken |
| 10 | Verktyg |
| 6 | Skydd |
| 6 | Maskiner |
| 11 | Pengar & avtal — öppna sedelutbyten |
| 17 | Status & samtal |
| 7 | Maskiner & fordon II |
| 6 | Hus & byggnader |
| 10 | Redskap & material II |
| 6 | Fler yrken |
| 10 | Pilar & riktning |
| 10 | Handlingar |

## Using a symbol

```html
<!-- inline (recolour via the stroke/fill attributes, or wrap and override) -->
<img src="symbols/verifierad.svg" alt="Verifierad" width="24" height="24">
```

Look a symbol up by meaning in `index.json`; never draw a second picture for a
thing that already has one.
