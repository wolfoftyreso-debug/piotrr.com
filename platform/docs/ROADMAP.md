> **SUPERSEDED (July 2026):** This document describes the pre-1.1 broad-marketplace direction. The authoritative foundation is now `CLAUDE.md` (Foundation Prompt v1.1 — verified LT→SE subcontracting, Sections 1–8). Where this document conflicts with CLAUDE.md, CLAUDE.md wins. Kept for historical context only.

# Piotrr — Roadmap

From the current codebase (Vite + React + shadcn/ui + Supabase, previously an
e-commerce app) to the Phase 1 marketplaces. Each phase ships working software while
preserving the architecture rules in `docs/ARCHITECTURE.md`.

## Phase 0 — Foundation (repurpose the codebase)

- [x] Establish vision & architecture docs
- [x] Remove/retire legacy e-commerce pages and components (edge functions and
      legacy tables remain to be retired once data is archived)
- [x] Introduce module-oriented source layout (`src/modules/<context>/…`)
- [x] Set up the vertical configuration model (categories in DB, metadata schemas
      per vertical in `src/modules/marketplace/config.ts`) — construction and
      automotive as first entries
- [x] Database migrations for core contexts: companies, verification, rfq,
      offers, orders, reviews, messaging, notifications
- [x] RBAC v1 via RLS policies (customer, company member/owner, admin);
      moderator/platform-admin back office remains
- [x] Audit log table + `accept_offer` writes audit entries; extend to all
      state-changing actions
- [ ] i18n scaffolding (multi-language); multi-currency money handling is in
      place on RFQs/offers/orders

## Phase 1a — Construction Marketplace (MVP)

- [x] Company registration and standardized profile (profile fields, services,
      portfolio; logo/cover upload via media buckets)
- [x] Permanent SEO-friendly company URLs (`/company/<slug>`); structured data
      markup remains
- [x] Company search with country/category/rating/verified filters (region/city
      and language filters remain)
- [x] RFQ flow: customer posts description, images, address, budget, deadline,
      preferred language + vertical-specific metadata
- [x] RFQ matching → in-app notifications to companies whose services and
      country coverage match (email/push channels remain)
- [x] Offers: companies submit quotations; customer accepts → Order created
      (transactional `accept_offer`)
- [x] Messaging between customer and company (/messages, threads started from
      RFQ and order pages, new-message notifications)
- [x] Order completion → verified customer review (all review dimensions)
- [x] Verification v1: companies apply for the next level from the dashboard;
      admin back office (/admin) approves/rejects via transactional
      `review_verification()` which updates level, trust score and notifies
      the company
- [x] Trust Score v1: verification, reviews, completed projects, response metrics
      — continuously recalculated by database triggers

## Phase 1b — Automotive Marketplace

- [ ] Enable the automotive vertical via configuration (categories, metadata schema:
      VIN, registration number, damage photos, insurance info, completion date)
- [ ] Workshop-specific RFQ intake and quote flow
- [ ] Verification Gold/Platinum levels; visibility boost in search ranking
- [ ] Trust Score v2: dispute history, documentation quality

## Phase 2 — Payments & Logistics

- [x] Payments module v1: every order gets a payment record; the customer
      secures funds in escrow (`pay_order_escrow`), release happens
      automatically on approved completion, admins can refund during disputes.
      Provider abstraction in place ('manual' today) — wire in Stripe/PSP next
- [x] Logistics module v1 (independent — references orders by plain UUID, no
      FK into marketplace tables): transport requests with pickup/delivery,
      insurance flag, status tracking (requested → booked → picked up →
      in transit → delivered) and notifications; provider integrations next
- [ ] PSP integration (Stripe) behind the payment provider abstraction
- [ ] Logistics provider integrations + shipping labels
- [ ] Dispute handling workflow in Administration (refund function exists)

## Phase 3 — Scale & self-hosting

- [ ] OpenSearch/Elasticsearch-backed search projections
- [ ] Extract high-load modules into services (event contracts already in place)
- [ ] Kubernetes deployment, Infrastructure as Code, full observability stack
- [ ] Analytics module: marketplace health, funnels

## Phase 4+ — New verticals

Enable additional verticals purely through configuration. Already live beyond
Phase 1: **Bakery & Food Production** (custom, recurring, wholesale and private
label orders) and **Manufacturing** (CNC, fabrication, molding, prototyping,
textiles, assembly) — both added as data + UI config only, with zero core
changes. Remaining candidates: industrial suppliers, agriculture, logistics,
legal, accounting, healthcare, consultants, freelancers, property services,
cleaning, security, renewable energy, installation services.

**Definition of done for the architecture:** adding a vertical requires zero changes
to core engine code.
