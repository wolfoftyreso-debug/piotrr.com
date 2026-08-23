# Product Surface Matrix (Constitution §29)

**Date:** 2026-08-11 · **Updated when the architecture changes, not when a
release ships.**

Read with `docs/ENTERPRISE-READINESS.md`, which holds the infrastructure
inspection and the open escalations. Nothing here has been deployed; every
"Tested" mark means verified against a production build on a workstation.

---

## The matrix

| Component | Required now | Architecture ready | Implemented | Tested | Production ready |
|---|---|---|---|---|---|
| Web | ✓ | ✓ | ✓ | ✓ | — ¹ |
| Apple / iOS | — | ◐ ² | — | — | — |
| Android | — | ◐ ² | — | — | — |
| API | ✓ | ◐ ³ | ◐ ³ | ✓ | — ¹ |
| Backend / domain | ✓ | ✓ | ✓ | ✓ | — ¹ |
| Database | ✓ | ✓ | ✓ | ✓ | — ¹ |
| Memory / state | ✓ | ◐ ⁴ | ◐ ⁴ | ✓ | — |
| Authentication | ✓ | ⚠ A | ✓ | ✓ | ⚠ A |
| Identity | ✓ | ⚠ A | ✓ | ✓ | ⚠ A |
| Authorization | ✓ | ✓ | ✓ | ✓ | — ¹ |
| ID verification | ✓ | ✓ ⁵ | ✓ | ✓ | — ¹ |
| File storage | ✓ | ✓ | ✓ | ✓ | — ¹ |
| Notifications | ✓ | ◐ ⁶ | ◐ ⁶ | ✓ | — |
| Background jobs | ✓ | ✓ | ✓ | ✓ | — ¹ |
| Observability | ✓ | ◐ ⁷ | ◐ ⁷ | — | ✗ |
| Security | ✓ | ✓ | ✓ | ✓ | — ¹ |
| CI/CD | ✓ | ✓ | ✓ | ◐ ⁸ | — |
| Kubernetes | ✓ | ✓ | ✓ | — ⁹ | — ⁹ |
| Backup / recovery | ✓ | ✓ | ✓ | ◐ ¹⁰ | — |
| Documentation | ✓ | ✓ | ✓ | n/a | ✓ |

✓ done · ◐ partial · ✗ absent · ⚠ blocked on an escalation · — not yet

¹ Nothing has been deployed. "Production ready" cannot be claimed for
anything until it has run in the target environment (§35).
² Backend contract only — see *Mobile readiness* below. No client code,
deliberately: §31 forbids a placeholder app.
³ The public read surface now exists; the authenticated surface does not.
See *The API gap*.
⁴ Short-term and long-term state are modelled; there is no cache layer
and no model/context memory because there are no models.
⁵ Not the platform's ID-verification service — this is the product's own
document verification engine, which is the business, not infrastructure.
⁶ Email only. Push architecture is undefined; it is a mobile concern and
is listed under *Mobile readiness*.
⁷ Structured logs and correlation ids exist. **No metrics, no traces, no
alerts.**
⁸ Pipelines run lint/typecheck/test/build/audit/secret-scan. No container
scan, no post-deploy smoke test.
⁹ Manifests are complete and valid; no cluster has ever applied them.
¹⁰ A dump/restore round-trip passed, but before the read-only root
filesystem and NetworkPolicies landed. RPO/RTO are still unstated.

---

## The API gap — measured, and smaller than it looks

**The finding.** The domain was reachable through **36 server actions
across 11 files** and **8 `/api/v1` endpoints**. Server actions are
web-only RPC. An iOS or Android client could not sign in, browse, submit
a request, upload a document, make an offer, or send a message. That is
exactly what §19 warns about: logic the web client can reach and the
mobile clients cannot.

**Why it is not as bad as that sounds.** The server actions were checked
for domain logic and contain **zero direct database access** — every one
delegates to `src/modules/*/service.ts`. The business logic is already
where §9 wants it, and `src/lib/api.ts` already provides the error shape,
the 401/403 distinction, scoped bearer keys and idempotency.

So the gap is **transport, not architecture**. Closing it is additive:
expose existing services over HTTP. No rewrite, and no risk of three
clients growing three business rules.

**Closed in this pass** — the surface a client needs before it can show
anything, and the part no escalation blocks:

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/v1/suppliers` | none | Search and browse, with `q`, `country`, `language`, `verified`, `limit` |
| `GET /api/v1/catalog` | none | 13 trades and 12 corridors — the vocabulary every client needs for filters and badges |

Both are published in `/api/v1/openapi.json` and covered by seven HTTP
checks, including that a Swedish trade name (`svetsning`) reaches
Lithuanian welding suppliers — the cross-locale synonym mapping now works
for any client, not just the web one.

**Still web-only, and ordered by what a mobile client needs first:**

1. Session creation (blocked on Escalation A — a mobile client cannot use
   a `__Host-` cookie flow; it needs tokens, and which issuer mints them
   is the open question)
2. RFQ submission and listing
3. Offer submission and comparison
4. Messaging
5. Document upload (presigned PUT already exists as a service; the
   presign step is an action)
6. Portal profile and capacity editing

---

## Mobile readiness (§3, §7, §8, §32)

What is already true, so a client can be built later without touching the
backend:

- **Domain models and validation** are Zod schemas shared across the
  boundary; the same shapes serve any client.
- **API versioning** — `/api/v1`, with a generated OpenAPI document.
- **Error contract** — `{ error: { message } }`, with 401 for missing
  credentials and 403 for insufficient ones, uniformly.
- **Machine auth** — scoped, revocable API keys (`bb_<prefix>_<secret>`),
  digest-only at rest. Suitable for integrations today; not the right
  primitive for an end-user mobile session.
- **Idempotency** — `Idempotency-Key` on creating POSTs, which is what
  makes a retry over a flaky mobile network safe (§20, §27).
- **Cursor pagination** on list endpoints.
- **File architecture** — object storage with presigned URLs, malware
  scanning, and default-deny on unscanned files. Resumable upload is not
  implemented but nothing precludes it.
- **i18n** — eight locales, all strings keyed. A client sends its locale.

What is undefined and must be decided before, not during, a mobile build:

- **Session model for a native client.** Cookies do not fit. Escalation A.
- **Push notifications.** No provider, no token registry, no delivery
  observability. Email is the only channel today.
- **Deep links.** No universal-link or app-link scheme; slugs are
  permanent, which is the hard part, so this is mostly configuration.
- **Offline and sync.** Not needed for the concierge model as it stands.
  Idempotency keys mean a queued action can be retried safely, which is
  the property that keeps the door open (§20).

---

## Escalations still open

Unchanged from `docs/ENTERPRISE-READINESS.md`, and this Constitution
**strengthens** rather than resolves them:

- **A. Own auth vs. platform identity.** §12 says do not build a separate
  auth system when the platform provides one. This system has one.
  Recommendation: platform IdP for `admin`/`ops`; own auth for external
  suppliers and buyers who will never be provisioned internally. **This
  now also blocks the mobile session model**, so it has become the
  critical-path decision rather than a tidy-up.
- **B. The platform is not reachable from this repository.** §4 lists 24
  services to inspect and reuse; none is visible. I will not write
  integrations against services I cannot inspect.
- **C. Scale mandate vs. binding stage discipline.** `CLAUDE.md` §2 caps
  the target at 50 suppliers and 20 buyers and forbids brokers, event
  buses and Redis. Concretely today: the rate limiter is in-process, so
  `replicas: 1` is load-bearing for correctness, and §28's horizontal
  scaling requires moving it to a shared store first.
