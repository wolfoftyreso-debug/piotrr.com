> **SUPERSEDED (July 2026):** This document describes the pre-1.1 broad-marketplace direction. The authoritative foundation is now `CLAUDE.md` (Foundation Prompt v1.1 — verified LT→SE subcontracting, Sections 1–8). Where this document conflicts with CLAUDE.md, CLAUDE.md wins. Kept for historical context only.

# Piotrr — Architecture

## Guiding qualities

The platform must be **API First, Cloud Native, Multi-tenant, Modular, Scalable,
Self-hosted, Production ready and Event driven**, and must support millions of users
without fundamental redesign.

## Architectural style

- **Domain Driven Design (DDD)** — each module below is a bounded context with its
  own ubiquitous language, aggregates and invariants.
- **Clean Architecture** — domain logic never depends on frameworks, databases or
  transport. Dependencies point inward: `domain ← application ← infrastructure/UI`.
- **CQRS where appropriate** — write models enforce invariants; read models
  (search indexes, profile pages, trust scores) are denormalized projections built
  from events.
- **Event-driven communication** — modules publish domain events; other modules
  subscribe. No module calls another module's internals directly.
- **Modular monolith first, services later** — modules are deployed together
  initially but keep strict boundaries (separate schemas, event-based integration)
  so they can be extracted into services when scale demands, without redesign.

## Core modules

| Module | Responsibility | Key events published |
|---|---|---|
| **Identity** | Accounts, personal identity, tenancy membership | `UserRegistered` |
| **Authentication** | Login, sessions, tokens, MFA | `UserAuthenticated` |
| **Users** | Customer profiles, preferences, saved searches | `UserProfileUpdated` |
| **Companies** | Company profiles, slugs/permanent URLs, services, portfolio | `CompanyCreated`, `CompanyProfileUpdated` |
| **Verification** | KYC/KYB, VAT checks, licenses, insurance, Bronze→Platinum levels | `CompanyVerified`, `VerificationLevelChanged` |
| **Trust Engine** | Continuous trust-score calculation from signals across modules | `TrustScoreUpdated` |
| **RFQ** | Request-for-quote lifecycle, matching to companies | `RfqPublished`, `RfqMatched` |
| **Offers** | Company quotations on RFQs | `OfferSubmitted`, `OfferAccepted` |
| **Orders** | Order lifecycle after an accepted offer | `OrderCreated`, `OrderCompleted`, `OrderDisputed` |
| **Payments** | Checkout, escrow-style flows, payouts, multi-currency | `PaymentCaptured`, `PayoutReleased` |
| **Logistics** | Transport booking, tracking, delivery confirmation, labels — **independent module** | `ShipmentBooked`, `ShipmentDelivered` |
| **Reviews** | Verified-customer reviews, per-dimension ratings, photos | `ReviewPublished` |
| **Messaging** | Customer ↔ company conversations, attachments | `MessageSent` |
| **Media** | Uploads, image processing, object storage | `MediaUploaded` |
| **Notifications** | Email, push, in-app, per-language templates | — |
| **Search** | Full-text + faceted search projections | — (consumer only) |
| **Administration** | Back office, moderation, dispute handling | `DisputeResolved` |
| **Analytics** | Metrics, funnels, marketplace health | — (consumer only) |
| **API Gateway** | Routing, authn/z enforcement, rate limiting, API versioning | — |

### Module rules

1. A module owns its data. No cross-module table joins or foreign keys.
2. Cross-module reads go through published contracts (APIs or read projections).
3. Cross-module writes happen only by reacting to events.
4. The **Logistics** module must remain deployable and usable independently of the
   marketplace modules.

## Multi-tenancy: the vertical model

The marketplace engine is **generic**. A *vertical* (construction, automotive, …) is
configuration + metadata, not code:

- **Category trees** per vertical (e.g. "Roof replacement" vs "Ceramic coating")
- **Metadata schemas** per vertical (automotive RFQs carry VIN, registration number,
  insurance info; construction RFQs carry address, budget, deadline)
- **Workflows** per vertical (states, required documents, matching rules)
- **Search filters** per vertical

Adding a vertical = registering its configuration. It must never require changes to
the core engine. Vertical-specific metadata is stored as validated, schema-versioned
JSONB — not as new columns on core tables.

## Trust Engine

Trust scores are computed continuously from event streams:

```
Verification events ─┐
Order events ────────┤
Review events ───────┼──▶ Trust Engine ──▶ TrustScoreUpdated ──▶ Search ranking,
Messaging metrics ───┤        (weighted,                          profile badges
Dispute events ──────┘         explainable)
```

Factors: verified identity, verified VAT, company age, completed projects, customer
reviews, average rating, response time, response rate, dispute history,
documentation quality, verification level. Weights are configuration, and every
score must be explainable (auditable factor breakdown).

## APIs

- **REST** for public and partner APIs; **GraphQL** for flexible client-facing reads.
- Every API is described with **OpenAPI** (REST) / SDL (GraphQL) and versioned.
- API First: capabilities ship as documented APIs before UI consumes them.

## Data & infrastructure

| Concern | Choice |
|---|---|
| Primary datastore | PostgreSQL (schema-per-module) |
| Cache / queues / rate limiting | Redis |
| Media | S3-compatible object storage |
| Full-text & faceted search | OpenSearch/Elasticsearch, fed by events |
| Packaging | Docker containers |
| Orchestration | Kubernetes (self-hostable) |
| Provisioning | Infrastructure as Code |
| Delivery | Git-based workflow, CI/CD pipelines |

## Cross-cutting requirements

- **RBAC** — roles: customer, company member, company admin, moderator, platform
  admin; enforced at the gateway and inside each module.
- **Audit logging** — every state-changing action recorded (who, what, when, why).
- **Multi-language** — all user-facing content localizable; companies declare
  languages spoken; RFQs carry a preferred language.
- **Multi-currency** — money is always stored as `(amount_minor_units, currency)`.
- **GDPR** — data minimization, right to erasure (with anonymized event retention),
  consent tracking, EU data residency.
- **Observability** — structured logging, metrics, tracing, alerting for every module.

## SEO

Company pages render server-side (or pre-render) with permanent, human-readable
URLs (`/company/<slug>`), structured data (schema.org `LocalBusiness`/`Organization`,
`AggregateRating`), localized metadata and sitemaps per country.

## Migration note

The current codebase (Vite SPA + Supabase) is the starting point, not the target.
Supabase (PostgreSQL + auth + storage + edge functions) may serve as the Phase 1
infrastructure, but all domain logic must live behind module boundaries so the
platform can be self-hosted (PostgreSQL/Kubernetes) without redesign. See
`docs/ROADMAP.md`.
