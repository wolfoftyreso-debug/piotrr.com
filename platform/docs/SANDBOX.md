# Piotrr — Sandbox

One command spins up a fully populated sandbox: Postgres 16 + MinIO, all
migrations, the LT→SE, PL→SE, LV→SE and EE→SE requirement catalogues, ten demo suppliers
in every verification state, the 75-company researched catalog (LT/LV/EE/PL
with certifications and awards, covering all thirteen trades), buyers, RFQs across the pipeline, offers
with frozen snapshots and a recorded deal.

## Prerequisites

- **Node.js 20+** — https://nodejs.org
- **Docker Desktop** (running) — https://docker.com/products/docker-desktop
- **Git**

## Start

```sh
git clone https://github.com/wolfoftyreso-debug/piotrr.git
cd piotrr
npm install
cp .env.example .env.local
npm run sandbox        # docker compose up + migrate + all seeds + dev server
```

Open **http://localhost:3000/sv** (or `/en`, `/lt`, `/lv`, `/et`, `/pl`).

Without Docker: point `DATABASE_URL` at any Postgres 16 and run
`npm run db:migrate && npm run db:seed && npm run db:seed-demo && npm run dev`.

## Demo accounts

| Role | Email | Password |
|---|---|---|
| Admin (back office) | `admin@piotrr.example` | `change-me-now` (sandbox seeds with `SEED_STAFF_PASSWORD=change-me-now`) |
| Ops (back office) | `ops@piotrr.example` | `change-me-now` |
| Supplier — Vilnius Weldworks (verified) | `supplier1@demo.piotrr.example` | `demo-password-123` |
| Supplier — Kaunas Steel Fitters (verified) | `supplier2@demo.piotrr.example` | `demo-password-123` |
| Suppliers 3–10 (various states) | `supplier3..10@demo.piotrr.example` | `demo-password-123` |

Buyers (`bygg.ab@demo.example` etc.) were auto-created from RFQ intake and
have no password yet — that is the real anonymous-buyer flow. Create your own
buyer at `/sv/register` to try the buyer side with a login.

> All demo passwords are for local sandboxes only. Never reuse them in a
> deployed environment.

## Guided tour (15 minutes)

**Ops (the moat):** sign in as ops → `/sv/admin`
1. Dashboard: cases by state, open RFQs, time-to-match, expiring documents.
2. Verification kanban → open *Panevėžys Pipe Pros* (in review) → walk items
   through the review queue.
3. *Klaipėda Offshore Crew*: expired — a lapsed critical document switched
   the badge off automatically (see the audit trail).
4. RFQ pipeline → qualify the Bergen RFQ → dispatch to verified suppliers.
5. Deals → CSV export (`/api/v1/deals/export`).

**Supplier (the Alibaba journey):** sign in as `supplier1@…`
1. Portal: company profile, capacity listings, requirement statuses.
2. Public profile via "View public profile" — the Verified panel shows only
   ops-verified facts.
3. Dispatched requests → open the RFQ room → offer form with named team
   (their cert status freezes into the offer).

**Buyer (Blocket-simple):** no login needed
1. `/sv/request-work` — submit a request; an account is created from your
   email; ops sees it instantly in the pipeline.
2. `/sv/suppliers` — search "welding", filter verified-only.
3. `/sv/markets/sweden` (+ norway/denmark) — the SEO campaign pages.

## Reset

```sh
docker compose down -v && npm run sandbox
```
