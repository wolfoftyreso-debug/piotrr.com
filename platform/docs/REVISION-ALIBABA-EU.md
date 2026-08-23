# Alibaba-revision: Baltikum → övriga EU

**Datum:** 2026-08-08 · **Målbild:** ett Alibaba-liknande tjänsteoffert-system
där baltiska (och polska) leverantörer möter köpare i hela EU.
**Metod:** mätt mot körande system — kodgenomgång, databasprobning och
funktionella tester, inte skrivbordsbedömning.

---

## 1. Sammanfattning

Plattformen är **strukturellt rätt byggd för EU-expansion** men **innehållsmässigt
låst till Sverige**. Korridorbegreppet (`fromCountry → toCountry` med egen
kravkatalog som data) är precis rätt abstraktion — att lägga till LT→DE är ett
sådd-block, inte kodarbete. Men `toCountry` används idag inte av någon logik,
alla fyra korridorer går mot SE, och kravkatalogerna är svenska myndighetskrav.

Mot Alibabas mekanik står vi starkare på det som är kärnan (verifiering,
offertjämförelse med fryst bevisläge) och saknar medvetet det som ligger utanför
Fas 0–1 (betalningar, omdömen, nivåer). Den enda mekanik vi saknar som verkligen
begränsar **skalning** är att leverantörer inte själva kan svara på öppna
förfrågningar — varje affär går genom ops.

**En lanseringsblockerande bugg hittades och åtgärdades under revisionen** (§4).

---

## 2. Mot Alibabas mekanik

| Alibaba-mekanik | Piotrr | Bedömning |
|---|---|---|
| Leverantörsprofil / storefront | Publik profil, permanent URL, kapacitet, portfölj, referenser | **Starkare** — bär verifierade fakta, inte bara påståenden |
| Kategoriträd och sökning | 13 yrken, FTS + trigram, sex språk, stavfelstolerant | **Likvärdig** |
| RFQ (offertförfrågan) | Publikt formulär, konto skapas automatiskt | **Likvärdig** |
| Offertjämförelse | Offerter med **fryst verifieringsbild** från inlämningsögonblicket | **Starkare** — Alibaba har ingen motsvarighet |
| Inquiry / meddelanden | Tråd per förfrågan-leverantör, e-postnotiser | Likvärdig |
| Verified Supplier | Tio dokumenterade krav, ops-granskade, revisionsspår, automatisk utgång | **Betydligt starkare** |
| Gold Supplier-nivåer | Medvetet aldrig — verifiering säljs inte | Avsiktligt bort |
| Trade Assurance (escrow) | Utanför Fas 0–1 | Avsiktligt bort |
| Omdömen och betyg | Utanför Fas 0–1; ops samlar strukturerade referenser | Avsiktligt bort |
| Produktlistor med pris/MOQ | Finns inte — tjänster, inte varor | Bedömt separat (TESTRAPPORT §5) |
| **Leverantören svarar själv på öppna RFQ:er** | **Saknas** — endast ops-utskick | **Verklig lucka, se §3** |
| **Indikativ prisnivå på profilen** | Saknas — kapacitet visas utan prisbild | **Verklig lucka** |
| Svarstid / aktivitetssignal | Saknas | Beslut krävs (se §3) |

## 3. De tre verkliga luckorna mot en Alibaba-liknande marknadsplats

**a) Ops är en flaskhals i varje affär.** Concierge-matchning var ett medvetet
Fas 0–1-val och rätt för de första femtio leverantörerna. Men i en EU-bred
marknadsplats blir det taket: varje förfrågan kräver att en människa väljer
mottagare. Alibabas modell är att förfrågan publiceras och leverantörer
självselekterar. Ett mellanläge som bevarar kvalitetskontrollen: ops kvalificerar
förfrågan (som idag), men **verifierade** leverantörer inom rätt yrke och korridor
kan sedan själva se och svara på den. Ops behåller vetorätten, men slipper vara
med i varje transaktion.

**b) Köparen ser ingen prisbild förrän efter en förfrågan.** Kapacitetslistorna
visar team, veckor och tidigaste start — men inget om kostnadsläge. Det gör
tröskeln till första kontakt onödigt hög. En indikativ intervallnivå per
kapacitetspost (t.ex. "riktpris 480–620 SEK/tim") skulle höja konverteringen
utan att låsa någon vid ett pris.

**c) Köparsidan är helt overifierad.** Ett köparkonto skapas automatiskt från en
e-postadress, utan någon kontroll. Det är rätt för låg friktion, men i
utstationeringssammanhang bär **köparen** beställaransvaret — och en leverantör
som lämnar en offert vet inte vem motparten är. Minst organisationsnummer och
verifierad e-post innan en förfrågan skickas ut är rimligt.

> Om ni vill ha svarstidsstatistik (Alibabas "response rate") behöver det ett
> uttryckligt beslut: det är en driftsfakta, men ligger nära de trust-scores som
> `CLAUDE.md` §7 förbjuder. Rekommendation: visa den för ops internt, inte publikt.

## 4. Bugg som hittades och åtgärdades

**Ett fullt verifierat polskt företag visades som "ej verifierad".**

Tre ställen i koden slog upp korridoren hårdkodat till `lt-se`: den publika
profilen, admins kandidatlista och — allvarligast — **offertens
verifieringssnapshot**. Ett polskt, lettiskt eller estniskt företag har sitt
ärende på sin egen korridor, så uppslaget returnerade noll fakta.

Empiriskt bevisat under revisionen:

```
Polskt företag, fullt verifierat på PL→SE-korridoren:
  uppslag mot PL-korridoren (korrekt):        true, 10 fakta
  uppslag mot LT-korridoren (det koden gjorde): false, 0 fakta
```

Konsekvensen var att tre fjärdedelar av leverantörsbasen aldrig kunde visa sin
verifiering, och att en inlämnad offert hade fryst in "ej verifierad" permanent —
i just den datastruktur som är avsedd att vara ett juridiskt bevisläge.

**Åtgärd:** korridoren härleds nu ur företagets faktiska ärende
(`resolveCompanyCorridorId`, `getVerifiedFactsForCompany`), vilket samtidigt är
den struktur EU-expansionen behöver — en leverantör kan hålla flera ärenden när
fler destinationsländer öppnas. Regressionstest tillagt (flödestestets steg 18).

## 5. EU-beredskap: vad som bär och vad som brister

**Bär redan:**

- **Korridormodellen.** `corridors` har `fromCountry` och `toCountry`, och
  kravkatalogen hänger på korridoren som data. Fyra korridorer med korrekta
  hemlandsmyndigheter finns redan (Registrų centras/Sodra, KRS-CEIDG/ZUS,
  Uzņēmumu reģistrs/VSAA, Äriregister/Sotsiaalkindlustusamet). Att lägga till
  LT→DE är ett sådd-block.
- **Verifieringsmotorn** är landsagnostisk: krav, nivå (företag/arbetare/uppdrag),
  giltighetstid och utgångslogik är generiska.
- **i18n-strukturen** — sex språk med full nyckelparitet, nya språk är en fil.

**Brister:**

| Hinder | Läge idag | Vad som krävs |
|---|---|---|
| Destinationsland används inte | `toCountry` finns men ingen logik läser det; alla korridorer går mot SE | Matchning och badge måste bli destinationsmedvetna |
| Förfrågans destination | `siteCountry` hårdkodas till `"SE"` i intag-formuläret | Landsväljare + validering mot öppna korridorer |
| Badge-semantik | Texten säger "Verifierad för arbete i Sverige" | Måste bli per destination — annars visas en badge som inte gäller där jobbet ska utföras |
| Kravkataloger | Endast svenska krav (F-skatt, ID06, Arbetsmiljöverket, kollektivavtal) | Per destination: DE (Zoll/MiLoG-anmälan, SOKA-BAU, §48b-frisedel), NL (WagwEU-meldloket, VCA), FR (SIPSI, carte BTP), DK (RUT), FI (arbetarskyddsanmälan) — **kräver juridisk research per land, inte kodarbete** |
| Valuta | Endast `EUR` och `SEK` | Minst DKK, NOK, PLN, CZK; ingen FX-omräkning (medvetet) |
| Språk | sv, en, lt, lv, et, pl | de, nl, fr, da, fi för respektive marknad |
| Marknadssidor | sweden, norway, denmark | En per målmarknad |

*(Tabellen beskriver läget vid revisionen. Allt utom nl/fr/fi är åtgärdat —
se §6.)*

**Den viktigaste risken är inte teknisk utan integritetsmässig:** så länge
matchningen inte är destinationsmedveten kan ops skicka en LT→SE-verifierad
leverantör till en tysk byggarbetsplats, och köparen ser en verifieringsbadge
som inte betyder någonting för Tyskland. Verifieringens trovärdighet är hela
affärsidén — den spärren bör byggas *innan* första icke-svenska korridoren
öppnas, inte efter.

## 6. Åtgärdat (2026-08-08)

Allt i den rekommenderade ordningen nedan är nu byggt och testat.

| Punkt | Läge | Vad som gjordes |
|---|---|---|
| Hårdkodad korridor | **Fixat** | `resolveCompanyCorridorId` / `getVerifiedFactsForCompany`; regressionstest steg 18 |
| 1. Destinationsmedveten matchning | **Fixat** | Förfrågan bär destinationsland (väljare i formuläret), `dispatchRfq` vägrar leverantörer som inte är verifierade för landet, badgen namnger destinationen. Steg 19 |
| 2. Andra och tredje destinationen | **Byggt** | Tolv korridorer: fyra ursprungsländer × SE/DE/DK. Tyska och danska kravkatalogerna researchade mot myndighetskällor (Zoll/MiLoG-anmälan, §48b-frisedel, SOKA-BAU; RUT, arbejdsskadeforsikring, AFU) med myndighet och källa sparade per krav |
| 3. Leverantörsinitierade offerter | **Byggt** | `listOpenRfqsForSupplier` + `selfDispatch`: verifierade leverantörer ser och svarar själva på kvalificerade förfrågningar för rätt destination. Ops kvalificerar fortfarande. Steg 20 |
| 4. Indikativ prisnivå | **Byggt** | Prisintervall per kapacitetspost (min/max, valuta, enhet), tydligt märkt icke-bindande |
| 5. Köparverifiering | **Byggt** | Organisationsnummer och företagsnamn krävs i förfrågan; `buyerIdentityGaps` visar vad som saknas |
| Valutor | **Byggt** | EUR, SEK, DKK, NOK, PLN, CZK — ingen FX-omräkning |
| Kategori i sökindex | **Fixat** | Migrationen var handskriven och aldrig registrerad i journalen, så den hade aldrig körts — kategorikorten fungerade bara av en slump |
| Demodata låg på fel korridor | **Fixat** | `seed-demo.ts` öppnade varje ärende på `lt-se`, så lettiska och estniska demoföretag granskades mot litauiska myndigheter. Ärendet öppnas nu på företagets hemkorridor |
| Språk för destinationerna | **Byggt** | de och da tillagda — åtta språk med full nyckelparitet. Kravkatalogerna bär destinationens eget språk: tyska krav har tyska namn, danska danska (migration 0011) |
| Marknadssida per målmarknad | **Byggt** | Tyskland tillagt; DE och DK markerade som levande korridorer. Norge kvar som "öppnar snart" — där finns ingen korridor |

**Kvar innan tysk eller dansk lansering:** kravkatalogerna är researchade via
sökmotorers återgivning eftersom byggmiljön blockerar direkthämtning. Varje
citerad myndighetssida måste öppnas och läsas innan en verkligt tysk eller
dansk leverantör verifieras. Två sakfel är särskilt lätta att göra och står
noterade i katalogen: tysk olycksfallsförsäkring (BG BAU) är **inte** ett
stående krav för korrekt utstationerade arbetare, och Danmark har **inget**
ID06-motsvarande sajtkort i kraft idag.

## 7. Rekommenderad ordning

1. **Gör matchning och badge destinationsmedvetna** (kod, litet) — RFQ får
   destinationsland, ops kan bara skicka till leverantörer verifierade för det
   landet, badgen namnger destinationen. Bygg detta före korridor nummer fem.
2. **Öppna en andra destination som pilot** — Tyskland eller Danmark. Kostnaden
   är juridisk research (kravkatalogen), inte utveckling.
3. **Leverantörsinitierade offerter på kvalificerade förfrågningar** — lyfter
   ops-flaskhalsen utan att ge upp kvalitetsgrinden.
4. **Indikativ prisnivå på kapacitetsposter** — sänker tröskeln till första
   kontakt.
5. **Lätt köparverifiering** — organisationsnummer och verifierad e-post.

Punkt 1 och 5 är dagar. Punkt 3 och 4 är veckor. Punkt 2 domineras av juridiskt
arbete per land och bör göras en marknad i taget med riktiga pilotaffärer.

## 8. Verifieringsstatus

Färsk databas, produktionsbygge: 51 enhetstester · smoke-svit · flödestest
**~198 assertions i 23 steg** · **130 HTTP-kontroller** · 3/3 Playwright-e2e ·
lint och typecheck gröna. Migrationer 0000–0011.

Steg 23 bevisar destinationerna empiriskt: de tyska och danska katalogerna
bär rätt krav (Zoll-anmälan, §48b, SOKA-BAU respektive RUT, AFU), **ID06 har
inte smugit in i någon av dem**, varje krav har namn på destinationens språk,
och en LT→DE-verifierad leverantör går att skicka till en tysk arbetsplats —
men inte till en svensk.
