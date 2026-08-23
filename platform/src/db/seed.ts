/**
 * Seed: LT→SE corridor, welding/fitting trades, the ten-requirement
 * catalogue (Section 5/M1) and the first admin/ops users.
 * New corridors are seeds, not code.
 */
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { logger } from "@/lib/logger";
import { corridors, requirementDefinitions, trades } from "@/modules/catalog/schema";
import { TRADE_SEED } from "@/modules/catalog/trade-seed";
import { users } from "@/modules/identity/schema";
import { hashPassword } from "@/modules/identity/password";
import { chooseStaffSeedPassword } from "./seed-support";

/** A destination-country requirement, as researched from its authority. */
interface DestinationRequirement {
  key: string;
  nameEn: string;
  nameSv: string;
  /** Name in the destination's own language — a German buyer reading a
   *  German catalogue should see the German term for the German duty. */
  nameLocal: string;
  scope: "company" | "worker" | "assignment";
  critical: 0 | 1;
  sortOrder: number;
  authority: string;
  sourceUrl: string;
  note?: string;
}

/**
 * Germany destination catalogue — researched from the responsible
 * authorities. Reused Swedish keys keep their meaning; country-specific
 * duties get their own keys. Notes record conditionality (sector, threshold)
 * so ops can see why an item applies.
 */
const DE_REQUIREMENTS: DestinationRequirement[] = [
  { key: "registry_extract", nameEn: "Home-country company registry extract", nameSv: "Registreringsbevis från hemlandets företagsregister",
    nameLocal: "Handelsregisterauszug aus dem Herkunftsland",
    scope: "company", critical: 1, sortOrder: 1,
    authority: "Home-country business register (LT Registrų centras, PL KRS/CEIDG, LV Uzņēmumu reģistrs, EE Äriregister)", sourceUrl: "https://international.soka-bau.de/en/for-employers/participation-check",
    note: "NOT INDEPENDENTLY CITED as a German statutory duty. Carried over from the Swedish catalogue as a home-country requirement: proof of legal existence is what the platform and the German counterparties (SOKA-BAU registration, the Finanzamt when applying for the Section 48b certificate) rely on to identify the undertaking. Treat the cited URL as context, not as a legal basis." },
  { key: "a1_certificate", nameEn: "A1 certificate for each posted worker", nameSv: "A1-intyg för varje utstationerad arbetstagare",
    nameLocal: "A1-Bescheinigung für jede entsandte Person",
    scope: "worker", critical: 1, sortOrder: 2,
    authority: "Home-country social security institution (issued under Reg. (EC) 883/2004); checked in Germany by Zoll/FKS and BG BAU", sourceUrl: "https://www.bgbau.de/themen/versicherungsschutz-und-leistungen/ausland/information-for-foreign-employers",
    note: "EU-wide, home-country issued. BG BAU states a foreign company needs an A1 certificate for every single posted employee and that the worker must carry it during the assignment. Home-country social security continues where the anticipated duration does not exceed 24 months and the worker does not replace another posted worker. CONDITIONAL KNOCK-ON: if the A1 preconditions are NOT met, the employer must instead register the workers with the German statutory accident insurance (BG BAU, SGB VII) - see also https://www.zoll.de/EN/Businesses/Work/Foreign-domiciled-employers-posting/Social-insurance-while-posted-abroad/Arrangements-within-the-EU/arrangements-within-the-EU_node.html" },
  { key: "vat_status", nameEn: "German tax registration - tax number (Steuernummer) and VAT ID (USt-IdNr.)", nameSv: "Tysk skatteregistrering - skattenummer och momsregistreringsnummer",
    nameLocal: "Deutsche steuerliche Registrierung — Steuernummer und USt-IdNr.",
    scope: "company", critical: 1, sortOrder: 3,
    authority: "Bundeszentralamt für Steuern (BZSt) for the USt-IdNr.; the centrally competent Finanzamt for the country of residence for the Steuernummer", sourceUrl: "https://www.bzst.de/EN/Businesses/VAT/VAT_ID/Assignment/assignment_node.html",
    note: "CONDITIONAL. BZSt: a foreign business must first be registered with the German tax office competent for its country of origin before it can be issued a German VAT ID. Whether German VAT actually has to be charged is a separate question - for construction works supplied to a German business customer the reverse-charge rule of Sec. 13b UStG normally shifts the VAT liability to the customer (https://www.gesetze-im-internet.de/ustg_1980/__13b.html). A German Steuernummer is in practice the entry point for the Sec. 48b exemption certificate. Verify per assignment rather than assuming a USt-IdNr. is always needed." },
  { key: "de_zoll_notification", nameEn: "Posting notification (Meldung) to German Customs via the Minimum Wage Notification Portal", nameSv: "Utstationeringsanmälan (Meldung) till tyska tullen via Meldeportal Mindestlohn",
    nameLocal: "Entsendemeldung an die Generalzolldirektion über das Meldeportal-Mindestlohn",
    scope: "assignment", critical: 1, sortOrder: 4,
    authority: "Generalzolldirektion / Finanzkontrolle Schwarzarbeit (FKS) - Zoll", sourceUrl: "https://www.zoll.de/EN/Businesses/Work/Foreign-domiciled-employers-posting/Obligatory-notification-workers-posted/Notification/notification_node.html",
    note: "SECTOR-SPECIFIC AND MANDATORY BEFORE WORK STARTS. Zoll: notifications are submitted online via www.meldeportal-mindestlohn.de and must be provided before each work or service begins. Duty applies to foreign-domiciled employers posting into (a) any sector listed in Sec. 2a SchwarzArbG - construction is one - and (b) any sector covered by the AEntG with minimum employment conditions and/or holiday fund contributions. Legal bases: Sec. 16 MiLoG plus MiLoMeldV, and Sec. 18 AEntG. Changes to a notified posting must be reported separately (https://www.zoll.de/EN/Businesses/Work/Foreign-domiciled-employers-posting/Obligatory-notification-workers-posted/Notification-of-changes/notification-of-changes.html). ASSOCIATED DUTY (not a separate catalogue item): a German-language set of contracts, time sheets and payslips must be kept available in Germany for the duration of the work, max 2 years, and the storage address must be stated - Sec. 17 MiLoG / Sec. 19 AEntG." },
  { key: "de_freistellungsbescheinigung", nameEn: "Construction withholding tax exemption certificate (Freistellungsbescheinigung nach Sec. 48b EStG)", nameSv: "Befrielsebevis från byggavdragsskatt (Freistellungsbescheinigung enligt Sec. 48b EStG)",
    nameLocal: "Freistellungsbescheinigung zur Bauabzugsteuer nach § 48b EStG",
    scope: "company", critical: 1, sortOrder: 5,
    authority: "The competent German Finanzamt (for foreign contractors: the tax office centrally responsible for the contractor's country of residence). Validity is verifiable in the BZSt EIBE database.", sourceUrl: "https://www.bzst.de/EN/Businesses/Construction_Withholding_Tax/construction_withholding_tax_node.html",
    note: "CONSTRUCTION-SECTOR ONLY. This is the closest German analogue to Swedish F-skatt. Without it the German customer must withhold construction withholding tax from the fee; withholding may be waived if the contractor produces a Sec. 48b certificate. BZSt is explicit that it does NOT issue these certificates - only the competent tax office does - but the certificate data is stored electronically at BZSt so the customer can verify it online. The list of centrally responsible tax offices per country of residence is on page 3 of the BZSt leaflet: https://www.bzst.de/SharedDocs/Downloads/EN/merkblatt_bauleistungen.pdf . Certificate has an explicit validity period - drives the expiry engine." },
  { key: "de_soka_bau", nameEn: "SOKA-BAU registration and holiday fund contributions (Urlaubskassenverfahren)", nameSv: "Registrering och avgifter till SOKA-BAU (semesterkassan för byggbranschen)",
    nameLocal: "SOKA-BAU-Anmeldung und Beiträge zum Urlaubskassenverfahren",
    scope: "company", critical: 1, sortOrder: 6,
    authority: "SOKA-BAU (Urlaubs- und Lohnausgleichskasse der Bauwirtschaft); scaffolding handled by SOKA-GERÜSTBAU; enforcement supported by Zoll", sourceUrl: "https://international.soka-bau.de/en/for-employers/paid-leave-scheme-and-legal-basis",
    note: "CONSTRUCTION-SECTOR ONLY. SOKA-BAU: a construction company based outside Germany must participate in the German paid-leave scheme if it takes on a construction contract in Germany and posts its commercial workers for that purpose; the same applies to temporary work agencies supplying construction firms. Legal basis: Sec. 8(1) AEntG plus the generally binding social-fund collective agreement (VTV). NOT covered by an A1 certificate - holiday fund contributions are not social security contributions. CONDITIONAL EXEMPTION: participation is not required where the employer would simultaneously owe contributions to a comparable institution in the home country and the German scheme does not credit those; exemption is applied for at SOKA-BAU. Whether the company is in scope can be tested at https://international.soka-bau.de/en/for-employers/participation-check . Zoll overview: https://www.zoll.de/EN/Businesses/Work/Foreign-domiciled-employers-posting/Minimum-conditions-of-employment/Holiday-fund-procedures/holiday-fund-procedures_node.html" },
  { key: "collective_agreement", nameEn: "Sector minimum wage / generally binding collective agreement compliance (AEntG, TV Mindestlohn)", nameSv: "Efterlevnad av branschminimilön / allmängiltigförklarat kollektivavtal (AEntG, TV Mindestlohn)",
    nameLocal: "Einhaltung des Branchenmindestlohns / allgemeinverbindlichen Tarifvertrags (AEntG, TV Mindestlohn)",
    scope: "company", critical: 1, sortOrder: 7,
    authority: "Bundesministerium für Arbeit und Soziales (declares agreements generally binding); enforced by Zoll / FKS", sourceUrl: "https://www.zoll.de/EN/Businesses/Work/Foreign-domiciled-employers-posting/Minimum-conditions-of-employment/Minimum-pay-pursuant-AEntG-AUEG/Industries-minimum-wage-pursuant-AEntG-wage-floors-pursuant-AUEG/industries-minimum-wage-pursuant-aentg-wage-floors-pursuant-aueg_node.html",
    note: "Unlike Sweden, this is NOT a membership question - it is a compliance obligation. Zoll: sector minimum wages follow from collective agreements declared generally applicable under the AEntG, and AEntG provisions take precedence over MiLoG provided the sector minimum does not fall below the statutory national minimum wage; the precedence covers not only the pay rate but all associated secondary obligations. For mainstream construction the relevant agreement framework is the Bundesrahmentarifvertrag Bau (BRTV) with the TV Mindestlohn wage floors. Model the evidence as a declaration of the applicable wage group plus payroll evidence, not as a membership certificate. Current rates: https://www.zoll.de/EN/Businesses/Work/Foreign-domiciled-employers-posting/Minimum-conditions-of-employment/Minimum-pay-pursuant-AEntG-AUEG/Industries-minimum-wage-pursuant-AEntG-wage-floors-pursuant-AUEG/overview_of_sector_specific_minimum_wages.html" },
  { key: "liability_insurance", nameEn: "Business liability insurance (Betriebshaftpflichtversicherung)", nameSv: "Ansvarsförsäkring (Betriebshaftpflichtversicherung)",
    nameLocal: "Betriebshaftpflichtversicherung",
    scope: "company", critical: 0, sortOrder: 8,
    authority: "Private insurer - no German public authority; no general statutory insurance duty for construction firms", sourceUrl: "https://www.ihk.de/koeln/hauptnavigation/beratung-und-services/versicherungen-fuer-unternehmen-5141790",
    note: "NOT A STATUTORY OBLIGATION for construction/craft businesses. IHK Koeln: business/professional liability insurance is legally prescribed only for certain professions (auditors, notaries, lawyers, tax advisers) - construction is not among them. Keep it in the catalogue as a buyer/platform requirement (German main contractors routinely require it contractually), not as a legal compliance item, and set critical=false. Capture insurer, coverage amount and expiry as in the Swedish catalogue. NOTE - do not confuse with the mandatory statutory ACCIDENT insurance (gesetzliche Unfallversicherung / BG BAU, SGB VII), which is compulsory for employees but is displaced for genuinely posted workers holding a valid A1 - see the a1_certificate note." },
  { key: "welder_qualifications", nameEn: "Welder and trade qualifications (EN ISO 9606-1; company EN 1090 EXC class where applicable)", nameSv: "Svetsarkvalifikationer (EN ISO 9606-1; företagets EN 1090 EXC-klass där det är tillämpligt)",
    nameLocal: "Schweißer- und Fachqualifikationen (EN ISO 9606-1; EN 1090 EXC-Klasse des Betriebs, soweit einschlägig)",
    scope: "worker", critical: 0, sortOrder: 9,
    authority: "Accredited certification bodies under harmonised European standards - no German-specific posting authority identified", sourceUrl: "https://www.zoll.de/EN/Businesses/Work/Foreign-domiciled-employers-posting/Minimum-conditions-of-employment/Other-obligations/other-obligations.html",
    note: "NOT VERIFIED AS A GERMAN POSTING-SPECIFIC OBLIGATION. No authority page was found imposing a German recognition step for welder qualifications on posted workers (contrast Denmark, where Arbejdstilsynet recognition is required). EN ISO 9606-1 and EN 1090 are harmonised European standards and certificates issued in LT/PL/LV/EE are used directly. Reused from the Swedish catalogue as a trade-competence requirement. The cited URL is the Zoll 'other obligations' page and is context only - it is not a legal basis for this item. Re-check before go-live." },
  { key: "reference_projects", nameEn: "Reference projects (minimum two, with contactable references)", nameSv: "Referensprojekt (minst två, med kontaktbara referenser)",
    nameLocal: "Referenzprojekte (mindestens zwei, mit kontaktierbaren Referenzen)",
    scope: "company", critical: 0, sortOrder: 10,
    authority: "Platform requirement - no public authority", sourceUrl: "",
    note: "PLATFORM REQUIREMENT, NOT A LEGAL OBLIGATION. Identical to the Swedish catalogue item. No citation applies." },
];

/**
 * Denmark destination catalogue — researched from the responsible
 * authorities. Reused Swedish keys keep their meaning; country-specific
 * duties get their own keys. Notes record conditionality (sector, threshold)
 * so ops can see why an item applies.
 */
const DK_REQUIREMENTS: DestinationRequirement[] = [
  { key: "registry_extract", nameEn: "Home-country company registry extract", nameSv: "Registreringsbevis från hemlandets företagsregister",
    nameLocal: "Registerudskrift fra hjemlandets virksomhedsregister",
    scope: "company", critical: 1, sortOrder: 1,
    authority: "Home-country business register (LT Registrų centras, PL KRS/CEIDG, LV Uzņēmumu reģistrs, EE Äriregister)", sourceUrl: "https://businessindenmark.virk.dk/authorities/stat/ERST/self-service/Register_of_Foreign_Service_Providers_RUT/guide-register-of-foreign-service-providers-rut/",
    note: "NOT INDEPENDENTLY CITED as a Danish statutory duty. Carried over from the Swedish catalogue. In practice the home-country registration number is what identifies the undertaking in the RUT notification and in any Danish VAT registration. Treat the cited URL as context, not as a legal basis." },
  { key: "a1_certificate", nameEn: "A1 certificate for each posted worker", nameSv: "A1-intyg för varje utstationerad arbetstagare",
    nameLocal: "A1-attest for hver udstationeret medarbejder",
    scope: "worker", critical: 1, sortOrder: 2,
    authority: "Home-country social security institution (Reg. (EC) 883/2004); relied on in Denmark by Udbetaling Danmark and Arbejdsmarkedets Erhvervssikring (AES)", sourceUrl: "https://workplacedenmark.dk/health-and-safety/work-accidents-and-insurance",
    note: "EU-wide, home-country issued. WorkplaceDenmark: to document that employees are insured in the home country they must bring an A1 document, and it is the employer's responsibility that employees apply for it BEFORE the posting period starts. IMPORTANT: the A1 does NOT remove the separate Danish work injury insurance duty - see dk_work_injury_insurance." },
  { key: "vat_status", nameEn: "Danish VAT registration (SE/CVR number)", nameSv: "Dansk momsregistrering (SE-/CVR-nummer)",
    nameLocal: "Dansk momsregistrering (SE-/CVR-nummer)",
    scope: "company", critical: 1, sortOrder: 3,
    authority: "Erhvervsstyrelsen / Skattestyrelsen, via Business in Denmark (virk.dk), form 'Registration of Non-Danish Company - Start - 40.112'", sourceUrl: "https://businessindenmark.virk.dk/guidance/VAT/register-and-pay-vat/",
    note: "CONDITIONAL BUT EFFECTIVELY ALWAYS ON FOR CONSTRUCTION. Business in Denmark: non-Danish companies are NOT covered by the DKK 50,000 revenue threshold and are obliged to register from the day they start VAT-liable activities in Denmark; registration must happen no later than 8 DAYS BEFORE activities start. Registration yields a Danish VAT number (SE-nummer). Separately, for building and construction work a building site is generally always regarded as a permanent establishment, and where no double taxation agreement exists it is a permanent establishment from day 1 - which pulls in corporate tax obligations too. See https://workplacedenmark.dk/taxes-and-vat/taxes-and-vat-for-foreign-service-providers" },
  { key: "dk_rut_notification", nameEn: "RUT notification - Register of Foreign Service Providers (Registret for Udenlandske Tjenesteydere)", nameSv: "RUT-anmälan - registret för utländska tjänsteleverantörer",
    nameLocal: "RUT-anmeldelse — Registret for Udenlandske Tjenesteydere",
    scope: "assignment", critical: 1, sortOrder: 4,
    authority: "Erhvervsstyrelsen (Danish Business Authority) - register hosted on Business in Denmark / virk.dk; compliance supervised and enforced by Arbejdstilsynet (Danish Working Environment Authority)", sourceUrl: "https://businessindenmark.virk.dk/authorities/stat/ERST/self-service/Register_of_Foreign_Service_Providers_RUT/",
    note: "MANDATORY BEFORE WORK BEGINS, NO DURATION THRESHOLD. Business in Denmark / WorkplaceDenmark: foreign service providers posting employees must notify RUT before work in Denmark begins; there is no upper or lower limit on the duration of the work period for it to count as a posting, and the posting commences as soon as the employee starts work. Notification is submitted digitally via Business in Denmark. SELF-EMPLOYED ARE CONDITIONAL: a self-employed person without employees only has to register if the service falls within selected sector codes - general building and construction work, or installation and repair of machinery and equipment. Temporary work agencies posting workers must also register. The Danish contracting party must notify Arbejdstilsynet if it has not received documentation of the RUT registration, which makes the RUT receipt the document Danish buyers actually ask for. See also https://workplacedenmark.dk/regulations-on-posting/register-foreign-service-providers-rut . RELATED ARBEJDSTILSYNET DUTIES (not separate catalogue items): every company working in Denmark must carry out a written workplace risk assessment (APV), and a health and safety organisation (AMO) must be set up - on building sites where at least 5 employees work at the same time for at least 14 days, otherwise at 10+ employees: https://workplacedenmark.dk/health-and-safety/health-and-safety-organisation" },
  { key: "dk_work_injury_insurance", nameEn: "Danish work injury insurance (arbejdsskadeforsikring / Workers' Compensation insurance)", nameSv: "Dansk arbetsskadeförsäkring (arbejdsskadeforsikring)",
    nameLocal: "Dansk arbejdsskadeforsikring for de udstationerede",
    scope: "company", critical: 1, sortOrder: 5,
    authority: "Private Danish-authorised insurance company; supervised by Arbejdsmarkedets Erhvervssikring (AES) / Arbejdstilsynet", sourceUrl: "https://workplacedenmark.dk/health-and-safety/work-accidents-and-insurance",
    note: "MANDATORY FOR POSTED WORKERS - THIS IS THE KEY DANISH DIFFERENCE. WorkplaceDenmark: as an employer of workers posted in Denmark you are obliged to insure your employees against the financial consequences of work accidents by taking out and paying for a Workers' Compensation insurance issued by an insurance company, and all work accidents must be reported. If an accident occurs without insurance the company owes back premiums and contributions for the uninsured period, is fined, and must pay compensation to the injured employee. The A1 certificate documents home-country social insurance but does not by itself discharge this Danish duty. Capture insurer, policy number and expiry - drives the expiry engine." },
  { key: "dk_afu_contribution", nameEn: "Contributions to the Danish Labour Market Fund for Posted Workers (Arbejdsmarkedets Fond for Udstationerede, AFU)", nameSv: "Avgifter till danska fonden för utstationerade (Arbejdsmarkedets Fond for Udstationerede, AFU)",
    nameLocal: "Bidrag til Arbejdsmarkedets Fond for Udstationerede (AFU)",
    scope: "company", critical: 1, sortOrder: 6,
    authority: "Arbejdsmarkedets Fond for Udstationerede (AFU), administered via Business in Denmark / Samlet Betaling", sourceUrl: "https://businessindenmark.virk.dk/guidance/the-danish-labour-market-fund-for-posted-workers-bid/afu-foreign-employer/",
    note: "CONDITIONAL: applies to a foreign employer registered in an EU/EEA member state that posts employees to Denmark to carry out work for a DANISH PRINCIPAL. Business in Denmark: contributions are collected on the basis of the RUT notification and calculated on the number of full-time employees carrying out the work in Denmark; a contribution payment order is issued each quarter for as long as services are provided in Denmark - so keeping RUT data current is part of this obligation. The fund guarantees posted workers' wages; if AFU pays wages on the employer's behalf, extraordinary contributions of 25 percent (rising to 40 or 50 percent on repeat) of the amount paid out are levied. Danish analogue to Germany's SOKA-BAU in that it is a fund obligation not covered by the A1. See also https://workplacedenmark.dk/working-conditions/danish-labour-market-fund/" },
  { key: "collective_agreement", nameEn: "Collective agreement status / pay in line with Danish construction agreements (overenskomst)", nameSv: "Kollektivavtalsstatus / lön enligt danska byggavtal (overenskomst)",
    nameLocal: "Overenskomststatus / løn på niveau med danske bygge- og anlægsoverenskomster",
    scope: "company", critical: 1, sortOrder: 7,
    authority: "No authority - Danish labour market model; sector agreement negotiated between DI (Dansk Industri) and 3F for the construction and civil engineering sector", sourceUrl: "https://workplacedenmark.dk/working-conditions/collective-agreements",
    note: "STRUCTURALLY DIFFERENT FROM GERMANY AND SWEDEN - THERE IS NO STATUTORY MINIMUM WAGE IN DENMARK (the only exception is posted drivers, who have a fixed minimum hourly rate). WorkplaceDenmark: pay is set by collective agreement or individual agreement, and Danish trade unions may take INDUSTRIAL ACTION to force a foreign posting company to sign a collective agreement. This makes collective agreement status a commercial risk item rather than a licence condition: model it as the Swedish enum (member / signed accession agreement (tiltrædelsesoverenskomst) / none) plus evidence, and surface it prominently to buyers because 'none' means blockade risk on Danish sites. Leading construction agreement: Bygge- og Anlaegsoverenskomsten between DI and 3F - https://workplacedenmark.dk/working-conditions/pay-and-working-hours/hourly-rate-construction . Background: https://workplacedenmark.dk/working-conditions/the-danish-labour-market" },
  { key: "welder_qualifications", nameEn: "Recognition of welding and other regulated trade qualifications by Arbejdstilsynet", nameSv: "Erkännande av svetsar- och andra reglerade yrkeskvalifikationer av Arbejdstilsynet",
    nameLocal: "Arbejdstilsynets anerkendelse af svejse- og andre regulerede fagkvalifikationer",
    scope: "worker", critical: 1, sortOrder: 8,
    authority: "Arbejdstilsynet (Danish Working Environment Authority)", sourceUrl: "https://workplacedenmark.dk/regulations-on-posting/recognition-of-qualifications",
    note: "GENUINE DANISH OBLIGATION, STRONGER THAN THE SWEDISH EQUIVALENT. WorkplaceDenmark: foreign employees working temporarily in Denmark must have the necessary qualifications; some foreign qualifications must be approved by the Danish WEA, others must be assured by the employer. Specifically for welding: companies may not employ or engage persons for welding work unless they have undertaken the relevant Danish training or education programme or otherwise attained evidence of formal qualifications, a certificate, or a LETTER OF RECOGNITION from Arbejdstilsynet. Either the company or the individual may apply. Apply here: https://at.dk/en/self-service/apply-to-have-foreign-qualifications-recognised/ . Arbejdstilsynet also publishes a list of areas where no prior verification is required - check it per trade before demanding evidence: https://at.dk/en/regulations/executive-orders/executive-order-of-recognition-of-professional-qualifications-acquired-abroad/list-of-areas-where-no-prior-verification-of-the-professional-qualifications-is-required/ . EN ISO 9606-1 / EN 1090 certificates remain the underlying technical evidence." },
  { key: "liability_insurance", nameEn: "Business liability insurance (erhvervsansvarsforsikring)", nameSv: "Ansvarsförsäkring (erhvervsansvarsforsikring)",
    nameLocal: "Erhvervsansvarsforsikring",
    scope: "company", critical: 0, sortOrder: 9,
    authority: "Private insurer - no Danish public authority; no statutory duty confirmed", sourceUrl: "https://workplacedenmark.dk/health-and-safety/work-accidents-and-insurance",
    note: "NOT CONFIRMED AS A DANISH STATUTORY OBLIGATION. The only insurance the cited Danish authority page makes compulsory for foreign employers is Workers' Compensation / work injury insurance (see dk_work_injury_insurance); no source was found imposing a general business liability insurance duty. Retained as a buyer/platform requirement only - Danish main contractors normally require it contractually. critical=false. The cited URL supports the work-injury duty, NOT this item." },
  { key: "reference_projects", nameEn: "Reference projects (minimum two, with contactable references)", nameSv: "Referensprojekt (minst två, med kontaktbara referenser)",
    nameLocal: "Referenceprojekter (mindst to, med kontaktbare referencer)",
    scope: "company", critical: 0, sortOrder: 10,
    authority: "Platform requirement - no public authority", sourceUrl: "",
    note: "PLATFORM REQUIREMENT, NOT A LEGAL OBLIGATION. Identical to the Swedish catalogue item. No citation applies." },
];

async function main() {
  // Trades — data, not code (Section 2). Broadened per the 2026-07
  // repositioning: construction and property trades alongside the
  // original industrial launch trades. The list itself lives in the
  // catalog module so the prerendered home page can render the same
  // categories without a database; this is still what fills the table.
  const [welding] = await db
    .insert(trades)
    .values(TRADE_SEED)
    .onConflictDoNothing()
    .returning();

  // Backfill later-added locale names on older databases (0006, 0011)
  for (const t of TRADE_SEED) {
    await db
      .update(trades)
      .set({ nameLv: t.nameLv, nameEt: t.nameEt, namePl: t.namePl, nameDe: t.nameDe, nameDa: t.nameDa })
      .where(eq(trades.slug, t.slug));
  }

  const weldingTrade =
    welding ??
    (await db.query.trades.findFirst({ where: eq(trades.slug, "welding") }));

  // Corridors — LT→SE (launch) and PL→SE. New corridors are seeds, not code.
  const ensureCorridor = async (
    slug: string,
    fromCountry: string,
    toCountry = "SE",
  ) => {
    const [row] = await db
      .insert(corridors)
      .values({ slug, fromCountry, toCountry, serviceType: "entreprenad" })
      .onConflictDoNothing()
      .returning();
    const found =
      row ?? (await db.query.corridors.findFirst({ where: eq(corridors.slug, slug) }));
    if (!found) throw new Error(`Corridor seed failed: ${slug}`);
    return found;
  };
  const corridor = await ensureCorridor("lt-se", "LT");
  const corridorPl = await ensureCorridor("pl-se", "PL");
  const corridorLv = await ensureCorridor("lv-se", "LV");
  const corridorEe = await ensureCorridor("ee-se", "EE");

  // Second and third destinations (audit item 2). Every supplier country
  // gets its own corridor, because verification is destination-specific.
  const ORIGINS = ["LT", "PL", "LV", "EE"] as const;
  const deCorridors = [] as { id: string; from: string }[];
  const dkCorridors = [] as { id: string; from: string }[];
  for (const from of ORIGINS) {
    const de = await ensureCorridor(`${from.toLowerCase()}-de`, from, "DE");
    const dk = await ensureCorridor(`${from.toLowerCase()}-dk`, from, "DK");
    deCorridors.push({ id: de.id, from });
    dkCorridors.push({ id: dk.id, from });
  }

  // Requirement catalogue — ten requirements per corridor, stored as data
  const R = (
    corridorId: string,
    key: string,
    nameEn: string,
    nameSv: string,
    nameLt: string,
    names: { lv: string; et: string; pl: string; de: string; da: string },
    scope: "company" | "worker" | "assignment",
    critical: 0 | 1,
    sortOrder: number,
    metadataSpec: Record<string, unknown> = {},
    tradeId: string | null = null,
  ) => ({
    corridorId,
    tradeId,
    key,
    nameEn,
    nameSv,
    nameLt,
    nameLv: names.lv,
    nameEt: names.et,
    namePl: names.pl,
    nameDe: names.de,
    nameDa: names.da,
    scope,
    critical,
    sortOrder,
    metadataSpec,
  });

  /**
   * One ten-requirement catalogue per corridor. The Swedish side is
   * identical everywhere (F-skatt, posted-worker notification, ID06,
   * insurance, collective agreement, welder qualifications, references);
   * only the supplier's HOME institutions differ, so those are parameters.
   */
  const corridorRequirements = (
    corridorId: string,
    home: {
      registryEn: string; registrySv: string; registryLt: string;
      registryLv: string; registryEt: string; registryPl: string;
      a1Issuer: string;
    },
  ) => [
    R(corridorId, "registry_extract", `Company registry extract (${home.registryEn})`, `Registerutdrag (${home.registrySv})`, `Įmonių registro išrašas (${home.registryLt})`, { lv: `Uzņēmumu reģistra izraksts (${home.registryLv})`, et: `Äriregistri väljavõte (${home.registryEt})`, pl: `Odpis z rejestru przedsiębiorców (${home.registryPl})`, de: `Handelsregisterauszug (${home.registryEn})`, da: `Registerudskrift (${home.registryEn})` }, "company", 1, 1),
    R(corridorId, "f_skatt", "Swedish F-skatt approval (Skatteverket)", "Godkänd för F-skatt (Skatteverket)", "Švedijos F-skatt patvirtinimas", { lv: "Zviedrijas F-skatt apstiprinājums (Skatteverket)", et: "Rootsi F-skatt kinnitus (Skatteverket)", pl: "Zatwierdzenie F-skatt (Skatteverket)", de: "Schwedische F-skatt-Genehmigung (Skatteverket)", da: "Svensk F-skatt-godkendelse (Skatteverket)" }, "company", 1, 2, { fields: ["approval_date"] }),
    R(corridorId, "vat_status", "VAT registration status", "Momsregistrering", "PVM registracijos statusas", { lv: "PVN reģistrācijas statuss", et: "KMKR registreeringu staatus", pl: "Status rejestracji VAT", de: "Umsatzsteuerliche Registrierung", da: "Momsregistrering" }, "company", 1, 3),
    R(corridorId, "a1_certificate", `A1 certificate per posted worker (${home.a1Issuer})`, `A1-intyg per utstationerad arbetare (${home.a1Issuer})`, `A1 pažymėjimas kiekvienam komandiruotam darbuotojui (${home.a1Issuer})`, { lv: `A1 sertifikāts katram norīkotajam darbiniekam (${home.a1Issuer})`, et: `A1 tõend iga lähetatud töötaja kohta (${home.a1Issuer})`, pl: `Zaświadczenie A1 dla każdego pracownika delegowanego (${home.a1Issuer})`, de: `A1-Bescheinigung je entsandter Person (${home.a1Issuer})`, da: `A1-attest pr. udstationeret medarbejder (${home.a1Issuer})` }, "worker", 1, 4, { fields: ["valid_from", "valid_until"] }),
    R(corridorId, "posted_worker_notification", "Posted-worker notification receipt (Arbetsmiljöverket)", "Utstationeringsanmälan (Arbetsmiljöverket)", "Komandiruoto darbuotojo pranešimo kvitas", { lv: "Norīkošanas paziņojuma apstiprinājums (Arbetsmiljöverket)", et: "Lähetatud töötaja teavituse kinnitus (Arbetsmiljöverket)", pl: "Potwierdzenie zgłoszenia delegowania (Arbetsmiljöverket)", de: "Entsendemeldung (Arbetsmiljöverket)", da: "Udstationeringsanmeldelse (Arbetsmiljöverket)" }, "assignment", 1, 5),
    R(corridorId, "id06", "ID06 status per worker", "ID06 per arbetare", "ID06 statusas kiekvienam darbuotojui", { lv: "ID06 statuss katram darbiniekam", et: "ID06 staatus iga töötaja kohta", pl: "Status ID06 dla każdego pracownika", de: "ID06-Status je Person", da: "ID06-status pr. medarbejder" }, "worker", 1, 6),
    R(corridorId, "liability_insurance", "Liability insurance (ansvarsförsäkring)", "Ansvarsförsäkring", "Civilinės atsakomybės draudimas", { lv: "Civiltiesiskās atbildības apdrošināšana", et: "Vastutuskindlustus", pl: "Ubezpieczenie OC", de: "Haftpflichtversicherung (ansvarsförsäkring)", da: "Ansvarsforsikring (ansvarsförsäkring)" }, "company", 1, 7, { fields: ["insurer", "coverage_amount_minor", "coverage_currency", "expiry"] }),
    R(corridorId, "collective_agreement", "Collective-agreement status", "Kollektivavtalsstatus", "Kolektyvinės sutarties statusas", { lv: "Koplīguma statuss", et: "Kollektiivlepingu staatus", pl: "Status układu zbiorowego", de: "Tarifbindungsstatus", da: "Overenskomststatus" }, "company", 0, 8, { enum: ["member", "hangavtal", "none"] }),
    R(corridorId, "welder_qualifications", "Welder qualifications ISO 9606-1 per worker; EN 1090 EXC class", "Svetsarprövning ISO 9606-1 per arbetare; EN 1090 EXC-klass", "Suvirintojų kvalifikacija ISO 9606-1; EN 1090 EXC klasė", { lv: "Metinātāju kvalifikācija ISO 9606-1; EN 1090 EXC klase", et: "Keevitajate kvalifikatsioon ISO 9606-1; EN 1090 EXC klass", pl: "Kwalifikacje spawaczy ISO 9606-1; klasa EXC wg EN 1090", de: "Schweißerqualifikation ISO 9606-1 je Person; EN 1090 EXC-Klasse", da: "Svejsecertifikat ISO 9606-1 pr. medarbejder; EN 1090 EXC-klasse" }, "worker", 1, 9, { fields: ["process", "valid_until", "en1090_exc_class"] }, weldingTrade?.id ?? null),
    R(corridorId, "reference_projects", "Reference projects (minimum two, contactable)", "Referensprojekt (minst två, kontaktbara)", "Referenciniai projektai (bent du, su kontaktais)", { lv: "Atsauces projekti (vismaz divi, ar kontaktiem)", et: "Referentsprojektid (vähemalt kaks, kontaktidega)", pl: "Projekty referencyjne (min. dwa, z kontaktem)", de: "Referenzprojekte (mindestens zwei, kontaktierbar)", da: "Referenceprojekter (mindst to, kontaktbare)" }, "company", 0, 10, { min_count: 2 }),
  ];

  const ALL_REQS = [
    ...corridorRequirements(corridor.id, {
      registryEn: "Registrų centras", registrySv: "Registrų centras", registryLt: "Registrų centras",
      registryLv: "Registrų centras", registryEt: "Registrų centras", registryPl: "Registrų centras",
      a1Issuer: "Sodra",
    }),
    ...corridorRequirements(corridorPl.id, {
      registryEn: "KRS/CEIDG", registrySv: "KRS/CEIDG", registryLt: "KRS/CEIDG",
      registryLv: "KRS/CEIDG", registryEt: "KRS/CEIDG", registryPl: "KRS lub CEIDG",
      a1Issuer: "ZUS",
    }),
    ...corridorRequirements(corridorLv.id, {
      registryEn: "Uzņēmumu reģistrs", registrySv: "Uzņēmumu reģistrs", registryLt: "Uzņēmumu reģistrs",
      registryLv: "Uzņēmumu reģistrs", registryEt: "Uzņēmumu reģistrs", registryPl: "Uzņēmumu reģistrs",
      a1Issuer: "VSAA",
    }),
    ...corridorRequirements(corridorEe.id, {
      registryEn: "Äriregister", registrySv: "Äriregister", registryLt: "Äriregister",
      registryLv: "Äriregister", registryEt: "Äriregister", registryPl: "Äriregister",
      a1Issuer: "Sotsiaalkindlustusamet",
    }),
  ];
  const destinationRows = [
    ...deCorridors.flatMap((c) =>
      DE_REQUIREMENTS.map((r) => ({
        corridorId: c.id,
        tradeId: r.key === "welder_qualifications" ? (weldingTrade?.id ?? null) : null,
        key: r.key,
        nameEn: r.nameEn,
        nameSv: r.nameSv,
        nameLt: r.nameEn,
        nameLv: r.nameEn,
        nameEt: r.nameEn,
        namePl: r.nameEn,
        nameDe: r.nameLocal,
        nameDa: r.nameEn,
        descriptionEn: r.note ?? null,
        scope: r.scope,
        critical: r.critical,
        sortOrder: r.sortOrder,
        metadataSpec: { authority: r.authority, sourceUrl: r.sourceUrl },
      })),
    ),
    ...dkCorridors.flatMap((c) =>
      DK_REQUIREMENTS.map((r) => ({
        corridorId: c.id,
        tradeId: r.key === "welder_qualifications" ? (weldingTrade?.id ?? null) : null,
        key: r.key,
        nameEn: r.nameEn,
        nameSv: r.nameSv,
        nameLt: r.nameEn,
        nameLv: r.nameEn,
        nameEt: r.nameEn,
        namePl: r.nameEn,
        nameDe: r.nameEn,
        nameDa: r.nameLocal,
        descriptionEn: r.note ?? null,
        scope: r.scope,
        critical: r.critical,
        sortOrder: r.sortOrder,
        metadataSpec: { authority: r.authority, sourceUrl: r.sourceUrl },
      })),
    ),
  ];

  await db
    .insert(requirementDefinitions)
    .values([...ALL_REQS, ...destinationRows])
    .onConflictDoNothing();

  // Backfill later-added locale names on older databases (0006, 0011)
  for (const r of ALL_REQS) {
    await db
      .update(requirementDefinitions)
      .set({ nameLv: r.nameLv, nameEt: r.nameEt, namePl: r.namePl, nameDe: r.nameDe, nameDa: r.nameDa })
      .where(
        and(
          eq(requirementDefinitions.corridorId, r.corridorId),
          eq(requirementDefinitions.key, r.key),
        ),
      );
  }

  // First internal users (concierge ops team). Change passwords immediately.
  const seedUsers: {
    email: string;
    name: string;
    role: "admin" | "ops";
  }[] = [
    { email: "admin@piotrr.example", name: "Admin", role: "admin" },
    { email: "ops@piotrr.example", name: "Ops", role: "ops" },
  ];
  const staff = chooseStaffSeedPassword(process.env.SEED_STAFF_PASSWORD);
  const staffHash = await hashPassword(staff.password);
  let createdStaff = 0;
  for (const u of seedUsers) {
    const inserted = await db
      .insert(users)
      .values({
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash: staffHash,
        emailVerifiedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: users.id });
    createdStaff += inserted.length;
  }
  // onConflictDoNothing means a re-seed never touches an existing (and
  // possibly rotated) password — only announce a password that was used.
  if (staff.generated && createdStaff > 0) {
    logger.warn(
      { password: staff.password },
      "Generated staff password for admin@/ops@piotrr.example — " +
        "shown ONCE, in this output only. Store it or change it after first sign-in. " +
        "For dev/e2e, seed with SEED_STAFF_PASSWORD=change-me-now instead.",
    );
  }

  logger.info(
    "seed complete: 12 corridors (4 origins x SE/DE/DK), 13 trades, 10 requirements each, 2 users",
  );
  await pool.end();
}

main().catch((error) => {
  logger.error(error, "seed failed");
  process.exit(1);
});
