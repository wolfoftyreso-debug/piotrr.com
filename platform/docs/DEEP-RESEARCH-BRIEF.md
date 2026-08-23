# Piotrr — testprotokoll för djupsökning

**Version:** 2026-08-08 · **Syfte:** underlag för en extern djupsökning (deep
research) som ska kartlägga **konkurrens, omvärld, marknad och vårt utförande**,
och landa i **konkreta åtgärder före driftsättning**.

**Så använder du filen:** klistra in hela dokumentet som första meddelande i ett
djupsökningsverktyg (t.ex. GPT deep research). Del A–C är fakta om vad som
faktiskt är byggt — behandla dem som givna men **falsifierbara**: flera av dem är
formulerade som påståenden du ska pröva. Del D är uppdraget. Del E är kravet på
hur svaret ska se ut.

> **Viktigt om ärlighet:** vi vill inte ha en pitch tillbaka. Vi vill ha en
> granskning. Om slutsatsen är att affärsmodellen inte håller, att marknaden är
> tagen, eller att vi byggt fel sak — säg det rakt, med källor. Ett artigt svar
> är ett värdelöst svar.

---

## Del A — Vad produkten är

Piotrr är en **verifierad marknadsplats för gränsöverskridande
underentreprenad** i EU. Utbudssidan är entreprenadföretag i Baltikum och Polen;
efterfrågesidan är beställare i Sverige, Tyskland och Danmark.

Kärnprodukten är **inte** marknadsplatsgränssnittet utan **verifierings- och
compliance-motorn**: att med dokument och revisionsspår bevisa att en leverantör
är regelrätt för arbete i destinationslandet. Affärslogiken är att köparen betalar
för att beställaransvarsrisken försvinner.

**Tjänster, inte varor.** Systemet kan inte sälja tillverkade produkter (möbler,
komponenter). Det är utrett och avfärdat: kapacitetsposter modellerar team,
förfrågningar modellerar arbete på plats, och verifieringen prövar
utstationeringsregler. Varor skulle kräva egen datamodell, egen
compliance-katalog (CE, produktansvar, tull) och eget penningflöde.

**Bindande tonregel:** baltiska yrkesarbetare framställs **aldrig** som "billig
arbetskraft". Kompetens, tillgänglighet och dokumenterad efterlevnad först;
totalkostnad är stödargument, aldrig rubrik.

**Affärsmodell idag:** gratis för köparen. Success fee från leverantören när en
affär går i lås. **Inga betalningar i plattformen** — fakturering sker manuellt
utanför systemet.

---

## Del B — Vad som är byggt (status per 2026-08-08)

### B1. Teknisk bas

| Område | Läge |
|---|---|
| Arkitektur | Modulär monolit, en deploybar container. Elva moduler: `identity`, `companies`, `verification`, `documents`, `catalog`, `search`, `rfq`, `offers`, `messaging`, `notifications`, `audit` |
| Stack | TypeScript strict, Next.js 15 (App Router), Postgres 16, Drizzle ORM |
| Databas | 28 tabeller, 12 append-only-migrationer (0000–0011) |
| Yta | 23 sidrutter, 11 API-rutter under `/api/v1` med genererad OpenAPI 3.1 |
| Kodstorlek | ~14 000 rader TS/TSX i `src/` |
| Sök | Postgres FTS (`tsvector`) + trigram, stavfelstolerant, yrkesnamn slås upp på alla språk |
| Auth | Auth.js, lösenord (scrypt) + magic link (engångstoken, hashad, 15 min) |
| Jobb | pg-boss i samma container: utgångssvep, outbox-dispatch, GDPR-gallring, malware-skanning |

### B2. Verifieringsmotorn (kärnan)

- **Tolv korridorer** som seed-data: fyra ursprungsländer (LT, PL, LV, EE) ×
  tre destinationer (SE, DE, DK). Nya korridorer är data, inte kod.
- **Tio krav per korridor**, med korrekta myndigheter i både ursprungs- och
  destinationsland. Exempel:
  - **SE:** F-skatt (Skatteverket), utstationeringsanmälan (Arbetsmiljöverket),
    ID06, kollektivavtalsstatus
  - **DE:** anmälan till Generalzolldirektion (MiLoG/AEntG),
    §48b-friskrivning (annars 15 % Bauabzugsteuer), SOKA-BAU
  - **DK:** RUT-anmälan, arbejdsskadeforsikring, AFU-bidrag
  - **Alla:** A1-intyg per utstationerad arbetare, ansvarsförsäkring,
    ISO 9606-1-svetsarkvalifikationer, referensprojekt
- **Binär verifiering.** Verifierad eller inte. Inga nivåer, ingen poäng, ingen
  koppling mellan verifiering och betald synlighet. Verifiering är aldrig till salu.
- **Destinationsmedveten matchning:** en Sverige-verifierad leverantör kan inte
  skickas till en tysk byggarbetsplats. Systemet vägrar.
- **Utgångsmotor:** nattligt svep varnar 30/14/3 dagar före utgång; ett utgånget
  kritiskt dokument släcker badgen automatiskt.
- **Fryst bevisläge:** varje offert bär en verifieringsögonblicksbild från
  inlämningsstunden. Senare förändringar påverkar den inte — avsiktligt, som
  juridiskt bevis.
- **Revisionsspår** på varje mutation (aktör, entitet, före/efter, tidpunkt).

### B3. Marknadsplatslagret

- Publika företagsprofiler på permanenta URL:er, med separation mellan
  **plattformsverifierade fakta** och **företagets egna uppgifter** (certifikat,
  utmärkelser märks tydligt som "angivna, ej verifierade").
- 13 yrken (svets, montage, snickeri, el, VVS, tak, betong, plattsättning,
  målning, mark, stål, rivning, fastighetsservice).
- **Katalog med 75 researchade riktiga företag** som *Unclaimed*: 28 LT, 17 PL,
  16 EE, 16 LV. 46 av dem har publikt angivna certifikat (ISO 3834, EN 1090 upp
  till EXC4, ISO 9001/14001/45001, ASME, IATF 16949). Claim-flöde med
  ops-granskning; ett claim ger **aldrig** verifiering.
- Kapacitetsposter med indikativt prisintervall (uttryckligen icke-bindande).
- Förfrågningsflöde: publikt formulär → konto skapas automatiskt → ops
  kvalificerar → utskick till verifierade leverantörer → offerter → accept →
  affär registreras för manuell fakturering.
- **Leverantörsinitierade offerter:** verifierade leverantörer kan själva se och
  svara på kvalificerade förfrågningar för rätt destination. Ops behåller
  kvalitetsgrinden men är inte med i varje transaktion.
- Meddelandetrådar per förfrågan–leverantör med e-postnotiser.
- **Åtta språk** med full nyckelparitet (446 nycklar var): sv, en, lt, lv, et, pl,
  de, da. Kravkatalogerna bär destinationens eget språk.
- SEO: SSR, JSON-LD, sitemap, hreflang, marknadssidor för Sverige, Tyskland,
  Danmark och Norge.

### B4. Drift och säkerhet

- **Självägd infrastruktur** (beslutat): egen AWS-nod, Terraform, k3s,
  självhanterad Postgres, MinIO för S3-API, egen SMTP-klient utan paketberoende.
  Varje integrationspunkt ligger bakom ett env-växlingsbart gränssnitt, så
  managed läge (RDS/S3/SES) är en konfigurationsändring bort.
- **Malware-skanning:** ClamAV, med två spärrar — en smittad fil lämnas aldrig
  ut, och smittad bevisning kan aldrig godkännas.
- **CI/CD:** ECR + GitHub OIDC-roll (inga långlivade nycklar), rullning på noden
  via SSM, migrationer körs till slut innan appen rullar.
- **E-post:** SPF/DKIM/DMARC som Terraform-records.
- **GDPR:** PII-märkning, mjukradering + nattlig gallring, dataexport per
  användare, all data i EU.
- Presignerade URL:er ≤ 15 min, RBAC i servicelagret, rate limiting.

### B5. Verifieringsstatus (körd mot färsk databas, produktionsbygge)

```
Lint + typecheck   grönt
Enhetstester       51
Smoke-svit         grön
Flödestest         23 steg, ~193 assertions (hela affärskedjan)
HTTP-revision      130 kontroller, 0 fel
Playwright e2e     3/3 (verifiera leverantör · publicera profil · förfrågan→affär)
```

---

## Del C — Vad som medvetet **inte** är byggt, och vad vi redan vet är svagt

### C1. Avsiktliga uteslutningar

Betalningar och escrow · omdömes- och betygssystem · trust-scores ·
brons/silver/guld-nivåer · automatisk matchning · logistikmodul · B2C ·
försäljning av fysiska varor · flervalutakonvertering.

**Pröva dessa, återuppfinn dem inte.** Vi vill veta *vilka* av uteslutningarna
som är rätt i Fas 0–1 och vilka som är ett strategiskt misstag — särskilt
betalningar och omdömen.

### C2. Kända svagheter (var självkritisk, lägg till fler)

1. **Katalogens 75 profiler är researchade via sökmotorers återgivning**, inte
   verifierade mot källan. Direkthämtning var blockerad i byggmiljön. Varje
   citerad uppgift måste öppnas och läsas innan publik lansering.
2. **Samma förbehåll gäller de tyska och danska kravkatalogerna.** Två kända
   fällor står noterade: tysk olycksfallsförsäkring (BG BAU) är **inte** ett
   stående krav för korrekt utstationerade arbetare med giltigt A1, och Danmark
   har **inget** ID06-motsvarande sajtkort i kraft.
3. **Unclaimed-profiler skapas utan företagets medgivande.** Juridiskt och
   anseendemässigt oprövat.
4. **Ingen riktig driftsättning har skett.** Allt är verifierat lokalt.
5. **Köparsidan är tunt verifierad** — organisationsnummer krävs, men kontrolleras
   inte mot register.
6. **Ingen transaktion sker i plattformen**, vilket gör success fee svår att driva
   in och disintermediering trivial efter första affären.
7. **Ops är fortfarande en människa i loopen** för kvalificering.
8. **Inget mätetal på leverantörens leveranskvalitet** — verifiering säger att
   pappren stämmer, inte att jobbet blir bra.

---

## Del D — Uppdraget

Arbeta i fem spår. Sök på **svenska, engelska, tyska, danska, litauiska och
polska** — mycket av det som betyder något finns inte på engelska. Ange källa och
datum för varje faktapåstående. Skilj tydligt på **belagt**, **rimligt antagande**
och **gissning**.

### D1. Konkurrens

- Vilka aktörer löser detta idag i korridorerna LT/PL/LV/EE → SE/DE/DK? Kartlägg
  minst tre kategorier: (a) digitala marknadsplatser för bygg-/industritjänster,
  (b) bemannings- och entreprenadförmedlare med baltisk utbudssida,
  (c) compliance-/utstationeringstjänster som säljs separat (RUT-/Zoll-anmälan
  som tjänst, A1-hantering, ID06-administration).
- För de fem mest relevanta: affärsmodell, prissättning, geografi,
  finansieringsläge, storlek om det går att belägga, och **vad de gör bättre än
  oss**.
- Finns någon som redan kombinerar marknadsplats *och* dokumenterad
  utstationeringsverifiering? Om ja — varför har de inte tagit marknaden? Om nej
  — varför inte, är det ett hål eller en gravsten?
- Sök särskilt efter **nedlagda** försök i den här nischen och vad som dödade dem.

### D2. Marknad

- Storleksuppskatta efterfrågan: utstationerade arbetare från LT/PL/LV/EE till
  SE/DE/DK per år, helst ur A1-statistik (EU-kommissionens
  utstationeringsrapporter), RUT-registret, det tyska Meldeportal och det svenska
  utstationeringsregistret.
- Var är bristen störst per yrke? Stämmer vår yrkeslista med var pengarna finns,
  eller borde vi smalna av?
- Vilken destination bör öppnas först på riktigt — SE, DE eller DK? Väg
  marknadsstorlek mot regulatorisk friktion mot konkurrensläge.
- Vad betalar en beställare idag för att slippa beställaransvarsrisken? Finns
  prispunkter att jämföra med (försäkring, juridisk rådgivning, egen
  compliance-personal)?
- **Betalningsviljan är antagandet hela affären vilar på.** Belägg eller
  falsifiera den.

### D3. Regelverk och omvärld

- Verifiera vår kravkatalog per destination mot primärkällor. Lista **fel,
  luckor och sådant vi kräver i onödan**:
  - **SE:** F-skatt, utstationeringsanmälan, ID06, kollektivavtalsstatus,
    beställaransvar
  - **DE:** MiLoG/AEntG-anmälan till Generalzolldirektion, §48b EStG, SOKA-BAU,
    AÜG-gränsdragningen mellan Werkvertrag och arbetskraftsuthyrning
  - **DK:** RUT, arbejdsskadeforsikring, AFU, arbejdsmiljø
  - **Alla:** A1 enligt förordning 883/2004, utstationeringsdirektivet
    (96/71/EG som ändrat genom 2018/957), och **det som är på väg** —
    ELA:s roll, eventuella digitala A1-krav, ändringar 2026–2027.
- Skenbart självständighetsproblem (falsk egenföretagare / *Scheinselbständigkeit*
  / bulvanentreprenad): hur exponerade blir vi som förmedlare?
- **Vårt eget GDPR-läge:** att publicera profiler för företag som inte bett om
  det — är berättigat intresse hållbart? Vad gäller när profilen innehåller
  namngivna personer? Finns prejudikat eller tillsynsbeslut?
- Plattformsansvar: DSA, P2B-förordningen — träffar de oss vid vår storlek?

### D4. Vårt utförande — granska det

Behandla Del B som påståenden att pröva, inte som sanning:

- Är **binär verifiering utan nivåer** rätt? Konkurrenter tjänar pengar på
  nivåer. Vi vägrar. Är det integritet eller intäktsbortfall?
- Är **concierge-matchning** rätt i Fas 0–1, och var går taket?
- **Success fee utan betalningsrail** — hur ofta kringgås det i jämförbara
  marknadsplatser, och vad gör de åt saken?
- Är **unclaimed-katalogen** en tillväxtmotor eller en anseenderisk? Vad har
  liknande kataloger (branschregister, leverantörsdatabaser) fått för mottagande?
- Vi har **åtta språk och tolv korridorer före första betalande kund**. Är det
  förberedelse eller förhalning?
- Vad borde vi ha byggt i stället för något av det ovan?

### D5. Före driftsättning

Ge en **prioriterad åtgärdslista** inför lansering. För varje punkt:

| Fält | Krav |
|---|---|
| Åtgärd | Konkret, genomförbar — inte "förbättra marknadsföringen" |
| Varför | Vilken risk eller möjlighet den adresserar, med källa |
| Insats | Timmar/dagar/veckor, och om det är kod, juridik eller säljarbete |
| Konsekvens av att strunta i den | Rakt uttryckt |
| Blockerande? | Ja/nej inför första riktiga kund |

Täck minst: juridisk exponering, GDPR, kravkatalogernas riktighet, prissättning,
go-to-market för första tio köparna, och vilket enda mätetal vi borde styra på
de första sex månaderna.

---

## Del E — Krav på svaret

1. **Källhänvisa allt.** Myndighetskällor för regelverk. Namngivna företag med
   URL för konkurrens. Statistik med årtal och utgivare. Utan källa: märk som
   antagande.
2. **Skilj på belagt och gissat.** Skriv ut osäkerheten.
3. **Motsäg oss där vi har fel.** Om del B påstår något som inte håller, eller
   del C missar en större risk — det är den mest värdefulla delen av svaret.
4. **Inga generiska råd.** "Bygg community" och "fokusera på UX" är brus.
   Varje rekommendation ska gå att påbörja på måndag.
5. **Rangordna.** Om vi bara hinner göra tre saker före lansering — vilka tre,
   och varför just de?
6. **Avsluta med en dom.** En rubrik: *bygg vidare*, *bygg om*, eller *lägg ned* —
   med det starkaste argumentet emot din egen slutsats redovisat.

### Föreslagen disposition

1. Sammanfattning (max en sida, domen först)
2. Konkurrenskarta med tabell
3. Marknadsstorlek och betalningsvilja
4. Regelverksgranskning per destination, med våra fel utpekade
5. Kritik av vårt utförande
6. Prioriterad åtgärdslista före driftsättning
7. Källförteckning

---

## Bilaga — nyckeltal att citera

| Mått | Värde |
|---|---|
| Moduler / tabeller / migrationer | 11 / 28 / 12 |
| Sidrutter / API-rutter | 23 / 11 |
| Korridorer | 12 (LT, PL, LV, EE × SE, DE, DK) |
| Krav per korridor | 10 |
| Yrken | 13 |
| Språk | 8, full nyckelparitet (446 nycklar) |
| Katalogprofiler | 75 unclaimed (28 LT, 17 PL, 16 EE, 16 LV), varav 46 med angivna certifikat |
| Tester | 51 enhet · smoke · flödestest 23 steg · 130 HTTP · 3 e2e |
| Betalande kunder | **0** |
| Genomförda affärer | **0** |
| Driftsättningar i produktion | **0** |

De tre sista raderna är de viktigaste i tabellen. Allt annat är förberedelse.
