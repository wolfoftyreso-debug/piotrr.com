# Piotrr — Nuläge & fortsatt plan (handoff-prompt)

> **Så använder du filen:** klistra in den som första meddelande i en ny
> Claude Code-session (eller be Claude läsa `docs/HANDOFF.md`). Den ger
> nuläget, fattade beslut och den prioriterade planen. Regelverket i
> `CLAUDE.md` (repo-roten) gäller alltid — denna fil kompletterar, den
> ersätter inte. Verifiera nuläget mot koden innan du bygger vidare.

---

## 1. Vad produkten är

Piotrr är en **verifierad marknadsplats för gränsöverskridande
underentreprenad** (entreprenad, inte bemanning). Kärnprodukten är
**verifierings- och compliance-motorn**: dokumentbevisad efterlevnad
(F-skatt, A1, utstationeringsanmälan, ID06, försäkring, kollektivavtal,
svetsarkvalifikationer) med fullt revisionsspår. Köpare betalar för att
beställaransvaret försvinner. Binär verifiering — aldrig till salu, inga
nivåer/poäng. Kärnbudskap: **"Rätt kompetens. Rätt pris. Rätt kvalitet."**
Tonregel (bindande, `docs/POSITIONING.md`): framställ aldrig baltisk
arbetskraft som "billig" — kompetens/tillgänglighet/kvalitet först.

## 2. Nuläge (2026-08-08) — allt nedan är byggt, testat och pushat

**Milstolpar M1–M4 klara** enligt `CLAUDE.md` §5, plus beställda utökningar:

- **M1 Verifieringsmotor:** ärende- och punktstatusmaskiner (rena funktioner,
  enhetstestade), 10-kravskatalog som DATA per korridor, expirymotor
  30/14/3 dagar med simulerad klocka i test, ops-kanban, dokumentgranskning,
  företags-360, badge styrs enbart av ärendestatus.
- **M2 Publikt lager:** permanenta profil-URL:er med redirects, verifierad
  facts-panel (endast plattformsverifierat), kapacitetslistningar, Postgres
  FTS+trigram-sök (verified först), SEO (JSON-LD, sitemap, hreflang),
  självbetjäningsportal för leverantörer.
- **M3 Efterfrågan:** RFQ-intag (anonym → auto-konto), ops-driven matchning
  (concierge), offerter med **fryst verifieringssnapshot vid inlämning**
  (enhetstestat att senare ändringar inte påverkar), deal-registrering +
  CSV-export, meddelandetrådar med e-postnotiser.
- **M4 Härdning:** 3 Playwright-e2e (verifiera/publicera/RFQ→deal), testad
  pg_dump/restore-rutin, rate limiting, demo-seed, ops-dashboard, runbook.

**Utökningar utöver foundation:**

- **Självbetjäning:** registrering företag/kund ("tänk Alibaba/Blocket"),
  portal med profil, dokument, kapacitet, portfolio.
- **Katalog: 75 researchade riktiga företag** (25 LT, 16 LV, 16 EE, 18 PL)
  som *Unclaimed* med källattribution per faktum; 46 med publikt angivna
  certifikat (ISO 3834, EN 1090 t.o.m. EXC4, ISO 9001/14001/45001, ASME,
  IATF 16949), 4 med utmärkelser (Diamenty Forbesa, Gazele Biznesu). Visas
  som "angivna (ej verifierade)" — skilt från verifieringspanelen.
  Claim-flöde: ansökan → ops-granskning → ägarskap (ger ALDRIG verifiering).
- **Profiler v2:** modererade projektbilder (pending→approved/rejected,
  endast ops publicerar) + referenser insamlade av ops (inget review-system).
- **8 språk:** sv, en, lt, lv, et, pl (leverantörssidan) + de, da
  (destinationssidan) — fullständiga kataloger med nyckelparitet; trades och
  krav har namn per språk i DB (fallback en).
- **12 korridorer som seeds:** fyra ursprungsländer (LT, PL, LV, EE) × tre
  destinationer (SE, DE, DK). Hemlandsmyndigheterna är korrekta per ursprung
  (Registrų centras/Sodra, KRS-CEIDG/ZUS, Uzņēmumu reģistrs/VSAA,
  Äriregister/Sotsiaalkindlustusamet) och destinationskraven per mål
  (SE: F-skatt/ID06/Arbetsmiljöverket · DE: Zoll-anmälan, §48b, SOKA-BAU ·
  DK: RUT, arbejdsskadeforsikring, AFU). Matchningen är destinationsmedveten:
  en Sverige-verifierad leverantör går inte att skicka till en tysk
  byggarbetsplats.
- **Blocket-inspirerad publik design:** sökhero, kategorirutnät (13 yrken),
  radannons-kort i katalogen, chip-filter — egen färgidentitet.
- **SEO-kampanjsidor** för Sverige, Tyskland, Danmark och Norge på alla
  åtta språk (kompetens-first copy).

**Självägd infra (förberedd, beslut fattade):**

- **Noll externa beroenden i drift:** Postgres via `DATABASE_URL` (inga
  RDS-features), S3-API mot MinIO (`S3_ENDPOINT`), **egen SMTP-klient utan
  paket** (`src/modules/notifications/smtp.ts`, STARTTLS/AUTH PLAIN, vägrar
  klartext-AUTH), Auth.js+scrypt, pg-boss i Postgres, outbox utan broker.
- **Terraform** (beslutat): `infra/terraform/` — VPC, Graviton-EC2 (SSM,
  ingen SSH), krypterad datavolym + DLM-snapshots, S3-backuphink + nattlig
  pg_dump-cron, alarm med auto-recovery, valfri Route 53.
  `orchestrator`-variabel: **k3s (default, beslutat av produktägaren)**
  eller compose.
- **Kubernetes:** `infra/k8s/` Kustomize (Postgres/MinIO StatefulSets,
  migrate-Job, app-Deployment, Traefik-ingress, cert-manager-issuer).
  Beslutet är nu inskrivet i `CLAUDE.md` Appendix B.
- **Compose-spår:** `docker-compose.selfhost.yml` + `docker-compose.proxy.yml`
  (Caddy TLS). Dokument: `docs/SELF-HOSTED.md`, `docs/RUNBOOK.md`.

**Plattformsfunktioner tillagda augusti 2026:** magic-link-inloggning
(e-postverifiering via EmailProvider, engångstoken hashad i databasen),
ops-UI för interna konton (`/admin/staff`), GDPR-export
(`/api/v1/me/export`) och nattlig gallring av mjukraderad PII,
cursor-paginering på `/api/v1`-listor, OpenAPI 3.1 ur Zod-schemana
(`/api/v1/openapi.json`), 401 vs 403 med korrekt semantik.

**Verifieringsstatus:** 51 enhetstester · DB-smoke · flödestest med ~198
assertions i 23 steg (`npm run test:flow`) · 130 HTTP-kontroller
(`npm run test:http`) · 3/3 Playwright-e2e mot produktionsbygge ·
lint + typecheck gröna. Migrationer 0000–0011 (append-only).

## 3. Köra lokalt

```sh
npm run sandbox        # docker compose + migrate + seed + demo + dev-server
# eller manuellt:
npm run db:migrate && npm run db:seed && npm run db:seed-demo
npm run db:seed-catalog          # 75 unclaimed-profiler
npm run test           # 51 enhetstester
npm run test:smoke     # kräver seedad databas
npm run test:flow      # hela affärskedjan, 23 steg
npm run test:http      # 130 kontroller mot körande server
npm run build && PORT=3100 node .next/standalone/server.js  # + kopiera .next/static → standalone
E2E_NO_SERVER=1 E2E_BASE_URL=http://localhost:3100 npx playwright test
```
Inlogg (seed): `admin@piotrr.example` / `ops@…` — lösenordet genereras av seeden och skrivs ut en gång; i dev seedas med `SEED_STAFF_PASSWORD=change-me-now`;
demo-leverantörer `supplier1..10@demo.piotrr.example` pw
`demo-password-123`. Chromium: förinstallerad — kör ALDRIG
`playwright install`.

## 4. Fortsatt plan (prioriterad)

**Före publik lansering (blockerande) — kräver riktiga miljöer, inte kod:**
1. **Manuell källkontroll av katalogens 75 profiler** — researchen gjordes
   via sökmotor-återgivningar (direkthämtning blockerad i byggmiljön);
   omverifiera varje citerad sida, korrigera/stryk vid avvikelse. Samma sak
   gäller de tyska och danska kravkatalogerna
   (se `docs/REVISION-ALIBABA-EU.md` §6).
2. **Riktig driftsättning** på egen AWS-nod: `terraform apply` →
   k3s-deploy enligt `infra/k8s/README.md`; DNS + TLS + `S3_ENDPOINT`
   (presignerade URL:er kräver exakt värdnamn). Öva restore-rutinen.
3. **E-postens sista bit:** generera DKIM-nyckeln på reläet och fyll i
   `mail_*`-variablerna i Terraform. Records och adapter finns; nyckeln kan
   bara skapas där reläet står.

**Byggt sedan augusti 2026 (samma omgång):**
- **Malware-skanning i drift:** ClamAV-tjänst i både compose och k3s,
  clamd INSTREAM-klient utan nytt beroende, jobb + svepning, och två
  spärrar — en smittad fil lämnas aldrig ut, och smittad bevisning kan
  aldrig godkännas. `docs/SELF-HOSTED.md` §6, flödestestets steg 22.
- **CI/CD hela vägen:** ECR + GitHub OIDC-roll i Terraform,
  `infra/k8s/deploy.sh` på noden, deploy-jobb i CI som hoppar över sig
  självt tills kontot är riggat.
- **SPF/DKIM/DMARC** som Terraform-records (`p=quarantine` att skärpa till
  `reject` när rapporterna är rena).

**Också byggt (DE/DK fullt ut, 2026-08):**
- **Åtta språk** — de och da tillagda med full nyckelparitet (446 nycklar
  per språk). `CLAUDE.md` Appendix B uppdaterad.
- **Tysklandsmarknad** som egen SEO-sida på alla åtta språk; DE och DK
  markerade som levande korridorer, Norge kvar som "öppnar snart".
- **Kravkatalogerna på destinationens eget språk** — tyska krav har tyska
  namn, danska har danska (migration 0011: `name_de`, `name_da` på trades
  och requirement_definitions).
- Arbetsspråk de/da och valutorna DKK/NOK/PLN/CZK i förfrågningsformuläret.
- Flödestestets steg 23 bevisar att DE/DK-katalogerna bär rätt krav (Zoll,
  §48b, SOKA-BAU respektive RUT, AFU), att ID06 *inte* smugit in i någon av
  dem, och att en LT→DE-verifierad leverantör går att skicka till en tysk
  byggarbetsplats — spegelbilden av steg 19:s vägran.

**Kort därefter:**
4. Ops-dashboard: fler nyckeltal när volymen finns (idag: ärenden per
   status, utgående dokument, öppna förfrågningar, tid till matchning).

**Klart sedan augusti 2026** (byggdes i "fyll på och bygg klart"-omgången):
LV→SE- och EE→SE-korridorer · magic-link-inloggning med e-postverifiering ·
ops-UI för interna konton · GDPR-export och nattlig gallring ·
cursor-paginering · OpenAPI-spec ur Zod · 29 byggföretag så alla 13
kategorier har leverantörer · `CLAUDE.md` Appendix B med fattade beslut.

**Principer som aldrig ruckas** (se `CLAUDE.md` §8): append-only-migrationer,
audit på varje mutation, modulgränser via service-interfaces, binär
verifiering, all UI-text via i18n, fråga innan nya beroenden.
