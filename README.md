# piotrr.com

The public site for **Piotrr** — the verified marketplace for cross-border
subcontracting. *Europe, ready to deliver.*

Verified suppliers from Lithuania, Poland, Latvia and Estonia for projects in
Sweden, Germany and Denmark. The product is the verification and compliance
engine: proving, with documents and an audit trail, that a supplier is fully
compliant to work abroad (F-skatt, A1, posted-worker notification, ID06,
insurance, collective-agreement status, trade certifications). Verification is
strictly binary and never for sale.

## Contents

- `index.html` — the landing page. A single, self-contained file: all CSS and
  JS inline, fonts from Google Fonts, no build step and no dependencies.

## Brand

- Wordmark **PIOTRR**, name **Piotrr**, domain **piotrr.com**.
- Palette (design tokens): Ink `#101217`, Paper `#F6F4EF`, Cobalt `#2456FF`
  (the signal colour — actions and links only), Steel `#68717D`, Line
  `#DDE1E6`, Success `#167A56` (verified-only). Light and dark themes.
- Type: Schibsted Grotesk (display), Public Sans (body), IBM Plex Mono
  (labels, requirement keys, data).

## Deploy

Static — host it anywhere. For GitHub Pages: Settings → Pages → deploy from the
`main` branch root. The `CNAME` file points the custom domain at `piotrr.com`
(set the DNS `A`/`CNAME` records externally); `.nojekyll` skips Jekyll
processing.
