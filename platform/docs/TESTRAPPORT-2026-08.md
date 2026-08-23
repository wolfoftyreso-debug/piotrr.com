# Piotrr — end-to-end-test och funktionsutvärdering

**Datum:** 2026-08-08 · **Testad version:** branch `claude/baltic-bridge-platform-vision-cx09a8`
**Metod:** databasen raderad och byggd från noll, alla sådder körda, sedan
fyra testnivåer mot ett riktigt produktionsbygge (`next build` → standalone
på port 3100 mot Postgres 16).

## 1. Sammanfattning

| Nivå | Omfattning | Resultat |
|---|---|---|
| Enhetstester (Vitest) | statusmaskiner, expirymotor, RBAC, offert-snapshot, rate limiting | **40/40** |
| DB-smoke (`npm run test:smoke`) | M1–M4:s Definition of Done | **grön**, 25 namngivna kontroller |
| Affärsflöde (`npm run test:flow`) | hela kedjan med två konkurrerande leverantörer | **47 kontroller i 13 steg** |
| HTTP-yta (`npm run test:http`) | 6 språk, SEO, auth-grindar, sök, API | **87/87** |
| Playwright e2e | tre kritiska flöden i webbläsare | **3/3** |

Kall start från tom databas till körbart system: **12 sekunder**.

## 2. Vad som verifierades fungera

**Verifieringsmotorn (kärnan).** Ärende materialiserar rätt antal kravpunkter
(7 företags-/uppdragsnivå + 3 per arbetare), varje punkt vandrar
`missing → submitted → in_review → approved`, och badgen tänds enbart när
ärendet når `verified`. Expirymotorn testad med simulerad klocka: ett utgånget
kritiskt dokument släcker badgen automatiskt, medan en 14-dagarsvarning skapar
en ops-uppgift **utan** att dra in verifieringen.

**Affärskedjan.** Köpare lämnar förfrågan anonymt (konto skapas automatiskt) →
ops kvalificerar och skickar ut → två leverantörer offererar → köparen
accepterar en → syskonoffert avslås automatiskt → ops registrerar affären →
succéavgiften räknas fram korrekt i CSV-exporten (8 % av 98 000 SEK).

**Offertens frysta verifieringsbild.** Efter att leverantör A:s verifiering
löpt ut visar den publika profilen "ej verifierad" — men den redan inlämnade
offerten bär fortfarande `companyVerified: true` med alla tio fakta. Historiken
är oföränderlig, vilket är hela poängen med revisionsspåret.

**RBAC.** Åtta negativa kontroller passerade: köpare kan inte kvalificera egen
förfrågan eller registrera affär, leverantör kan inte skicka ut förfrågningar
till sig själv, en konkurrent kan inte acceptera annans offert eller läsa
annans meddelandetråd, en leverantör kan inte tilldela sig själv ägarskap till
en katalogprofil, och ingen leverantör kan stapla två öppna offerter på samma
förfrågan. Alla åtta admin-sidor plus portalen är stängda för utloggade.

**Två korridorer.** PL→SE har egen kravkatalog med polska hemlandsinstitutioner
(KRS/CEIDG istället för Registrų centras, ZUS istället för Sodra), och ett
polskt ärende hämtar bevisligen bara krav ur den polska katalogen.

**Katalogövertagande.** Ansökan skapar ops-uppgift, ops godkänner, ägarskapet
flyttas — och övertagandet ger **inte** verifiering. Det bekräftades explicit.

**Revisionsspår.** Företagsändringar, ärendeövergångar, offerter, affärer och
övertaganden skriver alla revisionsposter.

## 3. Defekter som hittades och åtgärdades

| Fynd | Allvar | Åtgärd |
|---|---|---|
| Startsidan, leverantörskatalogen och förfrågningssidan saknade helt `canonical` och `hreflang` — sex språkversioner konkurrerade med varandra i sökresultaten. Marknads- och företagssidor hade det redan. | Medel (drabbar SEO-kampanjen direkt) | Ny `src/lib/seo.ts` med `localeAlternates()`, applicerad på de tre sidorna. Verifierat: 1 canonical + 6 hreflang per sida. |
| **Svensk fritextsökning gav noll träffar.** "svetsning" → 0 företag, trots att köparsidan är svensk. Företagstexterna är på engelska och yrkesnamnen indexerades inte. | **Hög** (köparna är svenskar) | Sökningen översätter nu ett yrkesnamn på valfritt av de sex språken till engelska innan matchning. Verifierat: svetsning / Suvirinimas / Metināšana / Keevitus / Spawanie ger alla 18 träffar. |
| Stavfel gav noll träffar ("weldng" → 0) trots att trigram var påslaget — `similarity()` jämför hela strängen och gav 0,16. | Låg–medel | Lade till `word_similarity(q, name) > 0.5` som matchar mot enskilt ord (0,57 för äkta stavfel, 0,10 för nonsens). Verifierat: "weldng" → 5 träffar, nonsens → 0. |
| Dubblerad `<option value="pl">Polski` i arbetsspråksväljaren. | Kosmetisk | Borttagen. |

## 4. Öppna fynd som inte är kodfel

**8 av 13 kategorikort leder till en tom sida.** Katalogen innehåller enbart
metall- och industriföretag; efter breddningen till bygg- och fastighetsyrken
finns 0 företag under Snickeri, Rivning, Markarbeten, Målning, VVS,
Fastighetsservice, Tak och Plattsättning. Svetsning har 18, Stål 10,
Industrimontage 3, Betong och El 1 vardera. Antingen fylls katalogen på inom
bygg innan lansering, eller så döljs tomma kategorier.

**API:t svarar 403 där 401 vore korrekt** för helt oautentiserade anrop. Ingen
säkerhetsrisk (anropet blockeras), men fel semantik för API-konsumenter.

**Manuell källkontroll av katalogens 46 profiler** kvarstår sedan tidigare —
researchen gjordes via sökmotorers återgivning eftersom byggmiljön blockerade
direkthämtning.

## 5. Kan man sälja produkter (möbler m.m.)? — Nej, inte idag

Frågan testades empiriskt: jag försökte lägga upp en litauisk möbeltillverkare
som säljer ekbord och följde flödet hela vägen.

| Steg | Utfall |
|---|---|
| Registrera tillverkaren som företag | **Fungerar** — namn, land, ort, beskrivning |
| Välja kategori | **Saknas** — de 13 yrkena är tjänster; närmast är "Snickeri", ingen tillverkningskategori finns |
| Lägga upp en artikel | **Går inte** — enda annonstypen är *kapacitet*: yrke, antal personer, tidigast start, veckor tillgängliga, baseringsort. Inget pris, ingen enhet, ingen kvantitet/MOQ, ingen ledtid, inget artikelnummer, inga produktbilder |
| Köparens förfrågan | **Fel form** — förfrågan är ett *arbetsuppdrag*: arbetsplatsadress, antal personer, startdatum, varaktighet, arbetsspråk. Kvantiteten "200 bord" fick tryckas in i fritextrubriken, och antal personer=1 / varaktighet=4 blev meningslöst brus |
| Offert | **Fel form** — `hourly` eller `fixed` totalpris. Inget styckpris × antal, inga leveransvillkor, ingen frakt |
| Verifiering | **Fel regelverk** — kravkatalogen är utstationeringsregler (F-skatt, A1, ID06, utstationeringsanmälan, kollektivavtal). Vid varuförsäljning finns inga utstationerade arbetare; där gäller CE/EN-märkning, produktansvar, EORI/tull, REACH, EPD och Incoterms |
| Sökning | **Hittar inget** — "oak dining table" gav 0, och sökningen returnerar alltid *företag*, aldrig artiklar |

**Slutsats:** plattformen är byggd för *entreprenad* — verifierade team som
utför arbete på en plats. Varuhandel är en annan affär med annan datamodell,
annat regelverk och andra pengaflöden (frakt, tull, leveransvillkor).

Att bygga det är fullt möjligt men är ett **eget spår**, inte en justering:
det kräver en produkttabell (artikel, enhet, styckpris, MOQ, ledtid, bilder,
HS-nummer), en produktförfrågan/order vid sidan av arbetsförfrågan, en egen
kravkatalog för produktcompliance, och sannolikt frakt- och tullstöd. Notera
att `CLAUDE.md` §7 uttryckligen lägger logistikmodul och betalningar utanför
Fas 0–1 — därför stannar jag här och inväntar besked istället för att bygga.

Om varuhandel ska in är den billigaste vägen framåt att först testa hypotesen
manuellt (ops förmedlar några möbelaffärer via befintlig meddelandefunktion och
fritextförfrågningar) innan datamodellen utökas.

## 6. Så kör du testerna själv

```sh
npm run test              # 40 enhetstester
npm run test:smoke        # kräver seedad databas
npm run test:flow         # hela affärskedjan, 47 kontroller
npm run build && PORT=3100 node .next/standalone/server.js &
npm run test:http         # 87 kontroller mot körande server
E2E_NO_SERVER=1 E2E_BASE_URL=http://localhost:3100 npx playwright test
```
