# BALTIC BRIDGE — Foundation Prompt (Phase 0–1)

**Version:** 1.1 · July 2026 · AWS edition
**Amendments:** see *Appendix B — decisions taken since v1.1* at the end of this file.
**How to use:** Save this file as `CLAUDE.md` in the repo root (or paste as the first message to your coding assistant). Sections 1–8 are the **build order**. Appendix A is long-term context only — it is *not* a build order, and nothing in it overrides Sections 1–8.

---

## → New here? Read `docs/AGENTS.md` first.

This file (`CLAUDE.md`) is the **binding product spec** — what to build and
the rules that constrain it. It is intentionally not an operations guide.

**`docs/AGENTS.md` is the operational entry point for an agent opening this
repo cold**: what already exists, how to start the database and the app,
how `bootstrap.sql` and migrations work, every test/lint/build/deploy
command, which env vars switch mock vs production, the known limitations,
and exactly what to work on next. It is kept verified against the running
code.

Fastest true signal that the repo is healthy: **`npm run verify`** (lint +
typecheck + unit tests + secret scan, no database, no server). With a
database, **`npm run verify:full`** adds the DB suites and a production
build. Both exit non-zero on any failure.

When code and this spec disagree about *what to build*, this spec wins;
when `docs/AGENTS.md` and reality disagree about *how things run*, fix
whichever is wrong and keep `AGENTS.md` true.

---

## 1. What you are building

Piotrr is a **verified cross-border subcontracting marketplace**. Launch corridor: **Lithuania → Sweden**. Launch trade group: **welders and industrial fitters**, offered as *entreprenad* (contracted work packages), not staffing.

The product is **not** the marketplace UI — it is the **verification and compliance engine**: proving, with documents and an audit trail, that a Baltic supplier is fully compliant for work in Sweden (F-skatt, A1, posted-worker notification, ID06, insurance, collective-agreement status, welding certifications). Buyers pay to make beställaransvar risk disappear. Everything else is plumbing around that.

The first users are **our own ops team** running a concierge model: they onboard suppliers, review documents, and broker the first deals manually. The software must make *them* fast before it makes anyone else self-serve.

## 2. Stage discipline — read before writing any code

- Build for the **first 50 suppliers and 20 buyers**, not millions of users. Correctness and auditability over throughput.
- **Modular monolith.** One deployable. No microservices, no Kubernetes, no CQRS, no message broker, no event bus, no GraphQL, no Elasticsearch, no Redis, no multi-tenant white-labeling.
- If a task seems to require anything in the "Out of scope" list (Section 7), **stop and ask** instead of building it.
- Future verticals are **data, not code**: categories, requirement catalogues and metadata live in tables. Never hard-code "welding" into module logic.
- Prefer boring, well-documented choices. Every dependency must earn its place; ask before adding any that is not in Section 3.

## 3. Tech stack (fixed — do not substitute)

Target environment: the company's existing **AWS organization**. All resources live in **`eu-north-1` (Stockholm)** for GDPR data residency.

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript end-to-end | strict mode |
| App | Next.js (App Router), single monolith | one container image (standalone output); serves UI + `/api/v1` REST routes |
| Database | Amazon RDS for PostgreSQL 16 | single `db.t4g`-class instance to start; PITR on; Multi-AZ when revenue justifies it; Drizzle ORM + drizzle-kit migrations |
| Search | Postgres full-text (`tsvector`) + trigram | no OpenSearch |
| Auth | Auth.js — email magic link + password | roles: `admin`, `ops`, `supplier`, `buyer` (RBAC); not Cognito |
| Files | Amazon S3, private buckets | presigned URLs (≤ 15 min); SSE-S3; separate versioned `documents` bucket for verification evidence; LocalStack or MinIO in dev |
| Email | Single `EmailProvider` interface | Amazon SES adapter (eu-north-1) as first implementation |
| Jobs/cron | `pg-boss` (Postgres-backed queue) inside the app container | expiry checks, notifications; EventBridge Scheduler may hit HTTP cron endpoints, but no Lambda/SQS job fabric |
| Secrets/config | SSM Parameter Store + Secrets Manager | injected at deploy; no secrets in repo or env files |
| i18n | `next-intl` — `sv`, `en`, `lt` | all user-facing strings via i18n from day one |
| Validation | Zod schemas shared client/server | |
| Logging | pino → stdout → CloudWatch Logs; `/healthz` endpoint | CloudWatch alarms on 5xx rate and job-queue depth; optional Sentry |
| Testing | Vitest (unit) + Playwright (e2e) | see Section 8 |
| Deploy | One ECS Fargate service (or App Runner) behind ALB + CloudFront; images in ECR | GitHub Actions with OIDC role: lint → typecheck → test → build → deploy |
| DNS/TLS | Route 53 + ACM | |
| IaC | Follow the existing infra convention (Terraform or CDK) | scope: VPC wiring, RDS, S3, ECS/App Runner, SES, alarms — nothing more |

Money is stored as `{ amount_minor: integer, currency: 'EUR' | 'SEK' }`. No FX conversion logic.

**AWS discipline:** existing infrastructure is leverage, not license. Phase 0–1 is still **one deployable container + RDS + S3 + SES** — no Lambda sprawl, no SQS/EventBridge event fabric, no DynamoDB, no Step Functions, no EKS. (Exception: if the org already operates a shared ECS/EKS cluster with a platform team, deploy the same single container there — the principle is one deployable, not a specific orchestrator.) The `outbox_events` table stays in Postgres; fanning it out to EventBridge is a Phase 2+ decision.

## 4. Architecture rules

1. **Module layout:** `src/modules/<name>/{domain,service,repo,api,ui}`. Modules: `identity`, `companies`, `verification`, `documents`, `capacity`, `rfq`, `offers`, `messaging`, `notifications`, `audit`, `admin`, `search`, `catalog` (trades/categories/requirement definitions).
2. **Boundaries:** a module never touches another module's tables. Cross-module calls go through exported service interfaces.
3. **Domain events, monolith-style:** state changes append to an `outbox_events` table in the same transaction (`event_type`, `payload`, `occurred_at`, `processed_at`). A single in-process dispatcher (pg-boss) fans out to subscribers (notifications, search indexing, audit). This preserves later service extraction without a broker today.
4. **Audit everything:** every mutation writes `audit_events` (actor, entity, action, before/after JSON diff, timestamp, request id). Verification decisions and offer submissions are legally sensitive — the audit trail is a feature, not overhead.
5. **API:** REST under `/api/v1`, OpenAPI spec generated from Zod schemas. Cursor pagination. Idempotency keys on all POST endpoints that create records.
6. **GDPR:** mark PII columns in schema comments; soft-delete + scheduled purge job; per-user data export endpoint; EU-hosted infrastructure only (`eu-north-1`); document retention policy configurable per document type.
7. **Security baseline:** RBAC checks in the service layer (not only UI), rate limiting on public endpoints, malware scanning on the documents bucket (GuardDuty Malware Protection for S3; scan-hook stub until enabled), signed URLs expire ≤ 15 min.

## 5. Build order — four milestones, in sequence

Do not start a milestone before the previous one's Definition of Done is met.

### M1 — Ops backbone: Supplier CRM + Verification Engine *(the moat — build first)*

Internal tool for `admin`/`ops` roles.

**Entities:** `Company`, `Contact`, `Worker`, `Document`, `RequirementDefinition`, `VerificationCase`, `VerificationItem`.

**Requirement catalogue** (seed data, corridor `LT→SE`, service type `entreprenad`, trade `welding/fitting` — stored as data so new corridors are seeds, not code):

1. Company registry extract (LT Registrų centras)
2. Swedish F-skatt approval (Skatteverket) — approval date required
3. VAT registration status
4. A1 certificate **per posted worker** (Sodra), with validity dates
5. Posted-worker notification receipt (Arbetsmiljöverket, utstationeringsregistret) — per assignment
6. ID06 status **per worker**
7. Liability insurance (ansvarsförsäkring) — insurer, coverage amount, expiry
8. Collective-agreement status — enum: `member / hängavtal / none`, with evidence upload
9. Welder qualifications **per worker** — ISO 9606-1 (process, validity); company EN 1090 EXC class where applicable
10. Reference projects — minimum two, with contactable references

**Behavior:**

- Each `VerificationItem` links a requirement to evidence: status `missing → submitted → in_review → approved / rejected`, plus `expired`; reviewer, decision note, and document(s) attached. Some requirements are company-level, some worker-level, some assignment-level — model the `scope` explicitly.
- `VerificationCase` state machine: `draft → in_review → verified → suspended | expired`. Company badge derives **only** from case state. Cover the state machine and expiry logic with unit tests.
- **Binary verification.** A company is `Verified` for a corridor or it is not. **Do not build bronze/silver/gold tiers, trust scores, or any linkage between verification and paid visibility.** Verification integrity is the brand; it is never for sale.
- **Expiry engine:** nightly job flags documents expiring in 30/14/3 days → creates ops tasks + supplier emails; a lapsed critical document automatically moves the case to `expired` and hides the badge. Test this.
- **Admin UI:** verification kanban (cases by state), document review queue with inline file preview, company 360° view (profile, workers, documents, history), ops task list.

**DoD:** ops can onboard a real Lithuanian supplier, upload and review all ten requirement types, verify the company, and see the badge flip automatically when a document expires (simulated clock in tests).

### M2 — Public layer: verified profiles + SEO

- Public page per company at permanent URL `/company/<slug>`: description, services, location, languages, year founded, headcount — plus a **"Verified for work in Sweden"** panel showing *only platform-verified facts* (org nr, F-skatt ✓ + date, insurance ✓ + coverage, collective-agreement status, certifications held). No self-reported ratings, no vanity metrics.
- **Capacity listings:** supplier (or ops on their behalf) posts available teams: trade, headcount, certifications, earliest start, weeks available, base location. Shown on profile and in search.
- Search/browse: trade, corridor, verified-only filter, earliest start, language — Postgres FTS + filters.
- SEO: SSR, meta/OG tags, JSON-LD `Organization`, `sitemap.xml`, `hreflang` for sv/en/lt. Slugs permanent; renames create redirects.
- Supplier self-service portal (thin): edit profile, upload documents into their verification case, manage capacity listings.

**DoD:** an unauthenticated buyer can find a verified welding team and understand exactly what "verified" means; Lighthouse SEO ≥ 90 on profile pages.

### M3 — Demand: RFQ intake, matching, offers

- **Buyer RFQ form** (public + logged-in): title, description, site address, trade, headcount needed, start date, duration, working language, attachments (drawings/photos), budget (optional). Buyer account auto-created on submit (email verification).
- **Ops-driven matching as a first-class feature** (concierge, not an afterthought): ops qualifies the RFQ, selects candidate suppliers, dispatches it. Auto-matching is a later optimization — do not build it now.
- **Offers:** supplier responds with rate model (`hourly` or `fixed`), price, team composition (named workers → their cert status shows automatically), earliest start, validity date. The buyer's comparison view shows each offer **with a verification snapshot frozen at submission time** (audit requirement).
- **RFQ lifecycle:** `new → qualified → dispatched → offers_in → accepted | lost | expired`. On `accepted`, ops records the deal: contract value, success-fee %, invoiced manually — **no payment processing in-platform**.
- **Messaging:** one thread per RFQ–supplier pair; email notifications with deep links; attachments supported.

**DoD:** a real RFQ can go from buyer submission to an accepted offer with the full audit trail, and ops can export deal data for invoicing.

### M4 — Hardening

Complete i18n coverage; Playwright e2e on the three critical flows (verify supplier / publish profile / RFQ-to-accepted-offer); RDS point-in-time recovery + automated snapshots, plus a weekly logical `pg_dump` to S3 and a **tested** restore runbook; rate limiting tuned; seed + demo data set; deployment runbook; basic ops dashboard (cases by state, expiring documents, open RFQs, time-to-match).

## 6. Data model sketch

`users`, `roles`, `companies`, `company_slugs`, `contacts`, `workers`, `documents`, `requirement_definitions`, `verification_cases`, `verification_items`, `capacity_listings`, `trades`, `corridors`, `rfqs`, `rfq_dispatches`, `offers`, `offer_team_members`, `deals`, `message_threads`, `messages`, `notifications`, `outbox_events`, `audit_events`, `ops_tasks`.

Conventions: UUID v7 PKs, `created_at`/`updated_at` everywhere, soft delete (`deleted_at`) on PII-bearing tables, enums as Postgres enums, all files referenced by object-storage key + checksum + uploaded_by.

## 7. Explicitly out of scope — do not build in Phase 0–1

Payments, escrow or invoicing automation · review/rating engine (ops collects structured references manually) · trust-score algorithms · bronze/silver/gold tiers · automotive vertical · B2C flows · logistics module · auto-matching · GraphQL · EKS/Kubernetes · OpenSearch/Elasticsearch · Redis · Lambda/SQS/EventBridge event fabric · DynamoDB · Step Functions · Cognito · mobile apps · AI features (quote analysis, translation) · multi-currency conversion · white-label/multi-tenant theming.

If asked to build any of these, refer back to this section and confirm with the product owner first.

## 8. Working agreement for the coding assistant

1. Work in small increments mapped to the milestones; propose a short plan per work session before writing code.
2. Ask before adding any dependency, service, or infrastructure not listed in Section 3.
3. Migrations are append-only and reviewed; never edit an applied migration.
4. Mandatory unit tests: verification state machine, expiry engine, RBAC guards, offer snapshot freezing.
5. Never weaken or bypass `audit_events` writes, even in "quick fixes".
6. Keep module boundaries intact; if a feature seems to need cross-module table access, redesign the interface instead.
7. All user-facing text goes through i18n keys — no hard-coded strings.
8. When the vision in Appendix A conflicts with Sections 1–8, Sections 1–8 win.

---

## Appendix A — Long-term vision (context only, not a build order)

Piotrr's ambition is to become Europe's most trusted marketplace for professional services and industrial capacity — "the verified bridge" between markets, starting Baltics→Nordics. Over time this can grow to: additional corridors (PL→SE, LT→NO, …); additional trades and verticals (manufacturing/components, construction specialties, automotive services, industrial suppliers, cleaning, installation, and more); a payments layer (escrow, milestone payments, success-fee automation); an integrated logistics module (transport booking, tracking, insurance); a review system fed only by verified completed deals; supplier subscriptions and enterprise APIs (ERP-connected capacity feeds); and eventually a generic marketplace engine where each vertical is configuration — its own categories, requirement catalogues, workflows and filters — on a shared core.

The architectural choices above exist to keep that path open cheaply: strict module boundaries and the outbox event log allow later extraction into services; the requirement catalogue and trade/corridor tables make new verticals seed data; the audit and verification primitives generalize to any regulated cross-border trade. But none of it is built until the current corridor proves paying demand. **Sequence is the strategy: verify → match → transact → expand.**


---

## Appendix B — Decisions taken since v1.1 (binding)

These were agreed with the product owner during Phase 0–1 and override the
matching lines in Sections 3 and 7. Everything else in Sections 1–8 stands.

1. **Self-owned infrastructure.** The platform runs on the company's own AWS
   account with no managed application services: self-managed PostgreSQL 16,
   MinIO for the S3 API, and an own SMTP relay through a dependency-free
   client. Every integration point stays behind an env-switchable interface,
   so managed mode (RDS/S3/SES) remains a config change away.
   See `docs/SELF-HOSTED.md`.
2. **Terraform** is the IaC convention — `infra/terraform/`.
3. **Kubernetes (k3s) is the orchestrator**, single-node on the same
   self-owned host — `infra/k8s/`. This supersedes the "no
   EKS/Kubernetes" line in Section 7: the principle behind it (one
   deployable, no microservices) is unchanged; k3s only replaces
   docker-compose as the thing that starts the container. Managed EKS and
   multi-service decomposition remain out of scope.
4. **Eight locales**: sv (default), en, lt, lv, et, pl — plus de and da,
   added when Germany and Denmark opened as destinations (2026-08). The
   supplier-side languages cover where the companies are; the
   destination-side languages cover where the buyers are.
5. **Twelve corridors**: four supplier countries (LT, PL, LV, EE) × three
   destinations (SE, DE, DK). Each corridor has its own ten-requirement
   catalogue with the correct home *and* destination institutions;
   corridors remain seed data, not code. Matching is destination-aware:
   a supplier verified for Sweden cannot be dispatched to a German site.
6. **Trade taxonomy broadened** beyond welding/fitting to thirteen
   construction and property trades (2026-07 repositioning). Tone guardrails
   in `docs/POSITIONING.md` are binding.
7. **Own authentication.** Auth.js is removed. Sessions are opaque
   256-bit tokens in an HttpOnly `__Host-` cookie, stored server-side as
   SHA-256 digests (`src/modules/identity/session.ts`) — revocable, unlike
   a JWT, so suspending an account ends its sessions on the next request.
   Passwords stay scrypt from `node:crypto`. Machine access to `/api/v1`
   uses scoped, revocable API keys (`bb_<prefix>_<secret>`, digest-only at
   rest). A key inherits its account's role; scopes only narrow it.
8. **Gitea is the forge.** Self-hosted git, CI (Gitea Actions) and
   container registry on the same node, replacing GitHub, GitHub Actions
   and ECR — see `docs/GITEA.md`. The GitHub/ECR pipeline is kept in the
   tree so managed mode remains a config change away, per decision 1.
9. **Reputation.** Ratings and merits exist (`src/modules/reputation/`),
   overriding the review-engine ban in Section 7. Verification stays binary
   and untouched by them: a rating requires a recorded deal (`deal_id` is
   UNIQUE), the average is withheld below three reviews, and every merit
   carries provenance — verified / platform / stated — grouped so a claim
   is never rendered as a checked fact.
10. **Documented agreements.** The dialogue belongs in the platform and the
   agreement is recorded there (`src/modules/agreements/`). The system does
   not author contract prose and gives no legal advice: terms are
   structured fields the parties confirm, and the guidance only lists what
   is unanswered or ambiguous. A signature binds one exact document hash,
   so editing a term voids prior signatures instead of silently changing
   what someone agreed to; a signed agreement can only be superseded,
   never edited. Ops may prepare an agreement but can never sign one.
11. **Still explicitly out of scope** (Section 7 otherwise unchanged):
   payments/escrow, review-and-rating engine, trust scores, tiers,
   auto-matching, logistics, B2C — and **selling physical goods**, which
   would need its own data model, compliance catalogue and money flow
   (see `docs/TESTRAPPORT-2026-08.md` §5 for the empirical assessment).
12. **UX Constitution + symbol language (binding).** Every user-facing
   surface follows the interaction doctrine in `docs/UX-CONSTITUTION.md`:
   action → immediate response → comprehensible result → clear next step;
   the three laws; status is never ambiguous (symbol **and** text, never
   colour alone). Status renders through `StatusBadge`; icons come from the
   110-symbol language (`docs/SYMBOLS.md`, the `Glyph` component over the
   sprite in `src/components/brand/symbols.tsx`) — one picture, one meaning,
   never a second picture for a thing that already has a symbol.
