> **SUPERSEDED (July 2026):** This document describes the pre-1.1 broad-marketplace direction. The authoritative foundation is now `CLAUDE.md` (Foundation Prompt v1.1 — verified LT→SE subcontracting, Sections 1–8). Where this document conflicts with CLAUDE.md, CLAUDE.md wins. Kept for historical context only.

# Piotrr — Domain Model

Bounded contexts and their key aggregates. This is the ubiquitous language for the
platform; code, APIs and database schemas should use these names.

## Company (Companies context)

A standardized, SEO-friendly business profile with a permanent URL
(`/company/<slug>`). Attributes:

- Company information: legal name, display name, description, logo, cover image
- Services and categories (per vertical)
- Location, countries served, languages spoken
- Contact information, website
- VAT number, organization number, year founded, number of employees
- Certifications, licenses, insurance
- Portfolio and project gallery
- Availability status

Derived/aggregated (read model, fed by events from other contexts):

- Reviews, overall rating
- Verification badges, verification level
- Trust score
- Response rate, average response time
- Completed projects, repeat customers, years on Piotrr

## Trust Score (Trust Engine context)

Automatically calculated per company, continuously updated. Input factors:

| Factor | Source context |
|---|---|
| Verified identity | Verification |
| Verified VAT | Verification |
| Verification level | Verification |
| Company age | Companies |
| Completed projects | Orders |
| Customer reviews & average rating | Reviews |
| Response time & response rate | Messaging / RFQ |
| Dispute history | Orders / Administration |
| Documentation quality | Companies / Verification |

Rules: weights are configuration; every score change is explainable and auditable;
recalculation is triggered by domain events, not cron-only.

## Verification (Verification context)

Levels: **Bronze → Silver → Gold → Platinum**. Each level is increasingly difficult
to obtain and grants higher search visibility. Verification covers identity (KYB),
VAT validation, licenses, insurance and documentation. Level changes emit
`VerificationLevelChanged` and feed the Trust Engine and Search ranking.

## Review (Reviews context)

Created by a **verified customer** only, after completed work (linked to an Order).
Dimensions:

- Overall rating
- Communication, Quality, Price, Delivery, Professionalism
- Would recommend (boolean)
- Photos
- Project description

## RFQ — Request For Quote (RFQ context)

A customer's request for offers. Core fields: description, images, address, budget,
deadline, preferred language, category (vertical-specific).

Vertical metadata (schema-versioned, validated JSONB):

- **Construction**: property type, scope (renovation, roof, plumbing, electrical,
  painting, flooring, carpentry, …)
- **Automotive**: photos, VIN, registration number, damage description, optional
  insurance information, desired completion date; service type (paint, body repair,
  collision, dent removal, rust, smart repair, wheels, detailing, ceramic coating,
  wrapping, PPF, windshield, mechanical, diagnostics, service, engine, transmission)

Lifecycle: `Draft → Published → Matched → Offered → Accepted | Expired | Withdrawn`.
Matching routes the RFQ to companies whose services, categories and coverage area fit.

## Offer (Offers context)

A company's quotation on an RFQ: price (multi-currency), scope, validity period,
estimated schedule, terms. Accepting an offer creates an Order.

## Order (Orders context)

The agreed job. Lifecycle:
`Created → InProgress → Delivered → Completed → Reviewed`, with `Disputed` and
`Cancelled` as exceptional states. Completion gates review eligibility and feeds
completed-project counts.

## Shipment (Logistics context — independent)

Door-to-door transport supporting: pickup booking, tracking, delivery confirmation,
transport insurance, estimated delivery time, shipping labels. Providers are
pluggable (vehicle transport, freight, couriers — e.g. future Eurotransport
integration). The module has no dependency on marketplace contexts; marketplace
orders reference shipments by ID only.

## Search (Search context — read model)

Faceted search over company and RFQ projections. Supported filters:

Country · Region · City · Distance · Service category · Rating · Price level ·
Availability · Verified companies · Languages · Certifications · Experience ·
Company size

Ranking incorporates trust score and verification level (higher levels ⇒ higher
visibility).
