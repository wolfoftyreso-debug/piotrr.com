# Piotrr — Positioning (July 2026 rebuild)

Decision by the product owner: keep the technology and functionality already
built; change the core message and broaden the trade scope. This document is
the messaging source of truth; `CLAUDE.md` Sections 1–8 continue to govern
architecture, stage discipline and the verification engine.

## Core idea

**Need help?** Piotrr connects Nordic companies and buyers with
skilled, verified contractors from the Baltics.

**Value proposition:** *The right skills. The right price. The right quality.*
(sv: *Rätt kompetens. Rätt pris. Rätt kvalitet.*)

We help buyers find serious Baltic contractors with transparent information
and an easy path to contact. Not just a listings site: every company gets a
modern profile with services, service areas, certifications, languages,
verification status, direct contact and quote requests.

## Tone guardrails (binding for all copy)

- Lead with **skills, availability, quality and documented compliance** —
  competitive price is the supporting argument, never the headline.
- **Never** frame Baltic professionals as "cheap labour" or lean on
  "domestic workers are too expensive" phrasing. Compare *total cost* and
  *cost base*, always paired with certificates and verification.
- Verification stays binary and ops-driven; transparency claims must map to
  what the platform actually verifies. Self-reported data (certifications,
  service areas) is always labeled as stated-by-the-company.

## Trade scope (data, not code — Section 2)

Broadened from the industrial launch trades to construction and property
trades, all seeded in the `trades` table:

Snickeri · Målning · Plattsättning · Tak · Betong · El · VVS · Markarbeten ·
Stål · Svets · Industrimontage · Rivning · Fastighetsservice

New trades require **no code changes** — the RFQ form, capacity listings,
matching and search pick them up from the catalog automatically.

## Profile contents (the "modern company profile")

| Brief item | Status |
|---|---|
| Services / categories | ✅ category + trade-based capacity listings |
| Service areas (arbetsområden) | ✅ new field, portal-editable, shown publicly |
| Certifications | ✅ self-reported field (labeled "stated, not verified") + the separate VERIFIED facts panel |
| Languages | ✅ |
| Verification status | ✅ binary badge, ops-driven |
| Quote request (offertförfrågan) | ✅ CTA on every profile |
| Direct contact | ✅ website link (personal contact data withheld for GDPR; contacts module holds it internally) |
| References | ⏳ next: structured references collected by ops (Section 7 keeps a review *engine* out of scope; ops-collected references are allowed) |
| Project images | ⏳ next: portfolio uploads via the documents/media flow + moderation |

## Deltas vs Foundation Prompt v1.1 (flagged, not silently changed)

1. **Trade breadth**: launch group was welders/fitters; now 13 trades.
   Architecturally free (trades are seeds). Ops capacity is the real
   constraint — verification of 10 requirement types per supplier is manual.
2. **"Privatpersoner" (consumers)**: Section 7 lists B2C flows as out of
   scope for Phase 0–1. The RFQ intake technically accepts any buyer today;
   consumer-specific flows (ROT-avdrag, consumer law, small-job pricing) are
   NOT built. Recommendation: keep messaging aimed at companies and
   professional buyers until B2C is a deliberate decision.
3. Requirement catalogues per trade may need trade-specific requirements
   (e.g. elbehörighet for electrical) — catalogue rows are seed data;
   ops defines them per corridor+trade when those trades activate.
