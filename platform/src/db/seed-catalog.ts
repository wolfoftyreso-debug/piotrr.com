/**
 * Piotrr catalog (75 profiles: LT, LV, EE, PL) — imported as UNCLAIMED.
 *
 * Batch 2 (2026-07): 10 Polish + 3 Latvian + 3 Estonian metal/industrial
 * companies, and 28 existing profiles enriched with publicly stated
 * certifications and awards.
 * Batch 3 (2026-08): 29 CONSTRUCTION-trade companies (11 LT, 5 LV, 5 EE,
 * 8 PL) so every trade category on the public site has real suppliers
 * behind it — carpentry, roofing, plumbing & HVAC, painting, groundworks,
 * demolition, tiling, property services, concrete and electrical.
 * NOTE: facts were extracted via search-engine renderings of the cited
 * pages (direct fetch was unavailable in the build environment) — the
 * pre-launch manual source check in the backlog covers re-verifying every
 * citation before these profiles go public.
 *
 * Data policy (per the catalog brief):
 * - Only facts published on open, public sources (B2B directories, EU
 *   partnering portals, the companies' own public pages). Source URL is
 *   stored on every profile and shown publicly for attribution.
 * - No personal contact data (GDPR): the public website is the contact path.
 * - No logos or images — none are licensed for reuse.
 * - Every profile is claimable: the company takes it over via the claim
 *   flow, reviewed by ops; verification (the badge) is a separate process
 *   and is NEVER granted by import.
 *
 * Descriptions paraphrase the sources; where a fact (city, founding year)
 * was not stated by the source it is left empty rather than guessed.
 */
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { logger } from "@/lib/logger";
import { users } from "@/modules/identity/schema";
import { companies, companySlugs } from "@/modules/companies/schema";
import { slugify } from "@/modules/companies/service";
import { writeAudit, appendOutbox } from "@/modules/audit/service";

interface CatalogEntry {
  name: string;
  country: "LT" | "LV" | "EE" | "PL";
  city?: string;
  category: string;
  description: string;
  website?: string;
  yearFounded?: number;
  /** Only certifications/awards explicitly stated on the cited source page */
  certifications?: string[];
  awards?: string[];
  sourceUrl: string;
  sourceName: string;
}

/** Facts found later for companies already imported — applied as updates */
interface CatalogEnrichment {
  name: string;
  certifications?: string[];
  awards?: string[];
  city?: string;
  yearFounded?: number;
  website?: string;
  sourceUrl: string;
  sourceName: string;
}

const WELD = "Welding & metal fabrication";
const PIPE = "Industrial piping & installation";
const CNC = "CNC machining";
const MARINE = "Shipbuilding & marine";
const STEEL = "Steel structures";
const STAINLESS = "Stainless equipment";

const CATALOG: CatalogEntry[] = [
  // ------------------------------------------------------------ Lithuania
  { name: "Westa Steel UAB", country: "LT", category: PIPE,
    description: "Pipe welding, installation, reconstruction and repair of steel parts and equipment. Subcontractor to major Lithuanian and foreign petrochemical, food-industry, pharmaceutical, construction and shipping companies.",
    website: "https://www.westasteel.lt", sourceUrl: "https://www.westasteel.lt/en/about-us/", sourceName: "westasteel.lt (company site)" },
  { name: "Rokvelas UAB", country: "LT", category: WELD,
    description: "Metal working services for small-serial and serial production, with over a decade of export experience.",
    sourceUrl: "https://www.europages.co.uk/companies/lithuania/steel-and-metal-fabrication.html", sourceName: "Europages" },
  { name: "Bermetix UAB", country: "LT", city: "Vilnius", category: STAINLESS,
    description: "European manufacturer of custom stainless steel tanks and process vessels.",
    sourceUrl: "https://www.europages.co.uk/companies/lithuania/welding.html", sourceName: "Europages" },
  { name: "Lavango Engineering LT UAB", country: "LT", category: STAINLESS,
    description: "Manufactures stainless steel equipment for the food industry.",
    sourceUrl: "https://www.europages.co.uk/companies/lithuania/metalworking.html", sourceName: "Europages" },
  { name: "Anvalda UAB", country: "LT", category: WELD,
    description: "Metal processing company with over 19 years of experience; services include TIG, MIG and MAG welding.",
    sourceUrl: "https://www.europages.co.uk/companies/lithuania/metalworking.html", sourceName: "Europages" },
  { name: "KELLA Engineering", country: "LT", category: WELD,
    description: "Metal fabrication services specializing in outsourced fabrication work.",
    sourceUrl: "https://www.europages.co.uk/companies/lithuania/welding%20work%20-%20steels%20and%20metal.html", sourceName: "Europages" },
  { name: "GRR Engineering UAB", country: "LT", category: WELD,
    description: "Manufactures industrial heat-treatment equipment and provides metal working services.",
    sourceUrl: "https://www.europages.co.uk/companies/lithuania/metalworking.html", sourceName: "Europages" },
  { name: "Stansefabrikken Automotive UAB", country: "LT", yearFounded: 2008, category: WELD,
    description: "Established in Lithuania in 2008; specializes in stamping, automatic welding and Tier 2 automotive supply.",
    sourceUrl: "https://www.europages.co.uk/companies/lithuania/metalworking.html", sourceName: "Europages" },
  { name: "Martema UAB", country: "LT", yearFounded: 2004, category: WELD,
    description: "Metal processing and construction manufacturing services in Lithuania and across Europe since 2004.",
    sourceUrl: "https://www.europages.co.uk/companies/lithuania/metalworking.html", sourceName: "Europages" },
  { name: "OSS UAB", country: "LT", category: PIPE,
    description: "Industrial piping installation and welding. Active in 15 countries over two decades, with representative offices in Sweden, Finland and Norway.",
    website: "https://www.oss.lt", sourceUrl: "https://www.oss.lt/", sourceName: "oss.lt (company site)" },
  { name: "Kijora UAB", country: "LT", yearFounded: 2014, category: PIPE,
    description: "Piping systems manufacturing and installation since 2014: welders, pipe fitters and plumbers executing plumbing, welding, pipeline installation and metal work to EU requirements.",
    website: "https://kijora.lt", sourceUrl: "https://kijora.lt/en/", sourceName: "kijora.lt (company site)" },
  { name: "Feliuga UAB", country: "LT", yearFounded: 2001, category: PIPE,
    description: "Prefabrication of pipe spools and piping components for power, petrochemical, paper-cellulose, offshore and shipbuilding projects since 2001.",
    sourceUrl: "https://www.copiermachinery.com/en/about-us/case-studies/feliuga-uab-increased-productivity-by-400/", sourceName: "Copier Machinery case study" },
  { name: "Western Baltija Shipbuilding UAB", country: "LT", city: "Klaipėda", category: MARINE,
    description: "Shipbuilding company with 70+ years of heritage and more than 600 employees, part of the Western Shipyard Group in Klaipėda.",
    website: "https://wbs.lt", sourceUrl: "https://wbs.lt/en/", sourceName: "wbs.lt (company site)" },
  { name: "Marine Technology (Western Shipyard Group)", country: "LT", city: "Klaipėda", category: MARINE,
    description: "Engineering, manufacturing and maintenance of complex structural steel components and cable-handling solutions for offshore energy, oil and gas; investing in robotic welding capacity at Klaipėda Seaport.",
    sourceUrl: "https://investlithuania.com/news/marine-technology-to-invest-e15m-in-advanced-manufacturing-expansion-in-klaipeda/", sourceName: "Invest Lithuania" },
  // -------------------------------------------------------------- Latvia
  { name: "Ritausmas Steel Constructions SIA", country: "LV", city: "Riga", yearFounded: 2013, category: STEEL,
    description: "Metal fabrication partner operating a 6 000 m² facility in Riga: laser and plasma cutting, sheet metal bending and certified steel structures to EN 3834 and EN 1090. Customers across Latvia and the Nordics.",
    website: "https://ritausmas.lv", sourceUrl: "https://ritausmas.lv/en/", sourceName: "ritausmas.lv (company site)" },
  { name: "Industrial Welding SIA", country: "LV", category: WELD,
    description: "Metal product manufacturer, part of a holding group with 25 years of experience.",
    sourceUrl: "https://www.emis.com/php/company-profile/LV/Industrial_Welding_SIA_en_9994966.html", sourceName: "EMIS company profile" },
  { name: "EMJ Metals SIA", country: "LV", category: WELD,
    description: "Metalworking, sheet metal processing and fabrication.",
    website: "https://www.emjmetals.lv", sourceUrl: "https://www.emjmetals.lv/", sourceName: "emjmetals.lv (company site)" },
  { name: "Metal Constructions (metals.lv)", country: "LV", category: STEEL,
    description: "Latvian manufacturer of metal constructions.",
    website: "https://metals.lv", sourceUrl: "https://metals.lv/en/", sourceName: "metals.lv (company site)" },
  { name: "CNC Latvia Ltd", country: "LV", city: "Riga", yearFounded: 2013, category: CNC,
    description: "Precision CNC turning and milling since 2013, exporting mainly to customers in Sweden, Norway and Finland.",
    website: "https://cnclatvia.com", sourceUrl: "https://cnclatvia.com/", sourceName: "cnclatvia.com (company site)" },
  { name: "Energoimpex Metal", country: "LV", city: "Ventspils", category: CNC,
    description: "Export-oriented CNC machining with 11 CNC machines, positioned near the Freeport of Ventspils.",
    sourceUrl: "https://metal.energoimpex.eu/cnc-machining/", sourceName: "energoimpex.eu (company site)" },
  { name: "Metalmeistars Ltd", country: "LV", yearFounded: 1998, category: WELD,
    description: "Latvian family business founded in 1998, providing precision metalworking in the Baltic states.",
    website: "https://www.metal.lv", sourceUrl: "https://www.metal.lv/en", sourceName: "metal.lv (company site)" },
  { name: "AB Metal Ltd", country: "LV", yearFounded: 2005, category: WELD,
    description: "Founded in 2005 within the Metalmeistars family of companies to develop export-market operations.",
    sourceUrl: "https://www.metal.lv/en", sourceName: "metal.lv (company site)" },
  // ------------------------------------------------------------- Estonia
  { name: "AGMA OÜ", country: "EE", city: "Tallinn", yearFounded: 2011, category: WELD,
    description: "Precision metal fabrication for demanding sectors: high-integrity metal structures for offshore, gas, oil, engineering and construction. 20–49 employees.",
    sourceUrl: "https://www.europages.co.uk/AGMA/00000003878045-298430001.html", sourceName: "Europages" },
  { name: "Monik OÜ", country: "EE", city: "Tallinn", category: STEEL,
    description: "Installation of metal structures in Estonia and Scandinavia; workshops equipped for welding, plasma cutting, forming and rolling in carbon, high-alloy and aluminium steels.",
    website: "https://www.monik.ee", sourceUrl: "https://www.monik.ee/", sourceName: "monik.ee (company site)" },
  { name: "Bernal Estonia OÜ", country: "EE", category: WELD,
    description: "Estonian metal fabrication company — \"let's create metal possibilities\".",
    website: "https://bernal.ee", sourceUrl: "https://bernal.ee/en/", sourceName: "bernal.ee (company site)" },
  { name: "Steel Element OÜ", country: "EE", city: "Tallinn", yearFounded: 2018, category: STEEL,
    description: "Steel fabrication with a capacity of 300 tonnes per month; installation services across Estonia, Scandinavia and Europe.",
    website: "https://steelelement.ee", sourceUrl: "https://steelelement.ee/en/", sourceName: "steelelement.ee (company site)" },
  { name: "Metalset OÜ", country: "EE", category: PIPE,
    description: "Prefabrication and installation of industrial pipelines and steel structures up to EXC3; approved supplier at several European companies.",
    website: "https://metalset.eu", sourceUrl: "https://metalset.eu/", sourceName: "metalset.eu (company site)" },
  { name: "Levstal Group", country: "EE", category: STEEL,
    description: "Metal engineering and steel fabrication, delivering structures to clients in Finland, Germany, Norway, Sweden, Austria, Italy and beyond.",
    website: "https://levstal.com", sourceUrl: "https://levstal.com/", sourceName: "levstal.com (company site)" },
  { name: "Scanweld AS", country: "EE", category: PIPE,
    description: "Fabrication and installation as core competences within industrial piping and steel work.",
    website: "https://www.scanweld.ee", sourceUrl: "https://www.scanweld.ee/core-competence/our-core-competence/fabrication-installation/", sourceName: "scanweld.ee (company site)" },
  { name: "Radius Machining OÜ", country: "EE", city: "Tallinn", category: CNC,
    description: "Serial CNC turning and milling for two decades, from mechanical engineering to aerospace, with sites in Tallinn, Tartu and Pärnu serving Scandinavian and Central European customers.",
    sourceUrl: "https://estonianexport.ee/directory/listing/radius-machining-ou/", sourceName: "Estonian Export Directory" },
  { name: "Estanc AS", country: "EE", city: "Rae, Harju County", yearFounded: 1992, category: STAINLESS,
    description: "Family-owned manufacturer of process equipment, tanks and pressure vessels in carbon and stainless steel, founded in 1992, with a 10,500 m² production complex near Tallinn where carbon and stainless steel production are separated.",
    website: "https://estanc.eu",
    certifications: ["ISO 9001", "ISO 3834-2", "EN 1090", "DNV GL Class I & II", "ASME U", "ASME U2"],
    sourceUrl: "https://estanc.eu/certificates/", sourceName: "estanc.eu (company site)" },
  { name: "Polinord OÜ", country: "EE", city: "Maardu", yearFounded: 2006, category: WELD,
    description: "Medium-sized mechanical engineering and metalworking company founded in 2006 that designs, manufactures and installs metal structures for construction and mechanical engineering in Estonia and abroad; certified to EN 1090-2 EXC2 and ISO 3834-3 since 2014.",
    website: "https://polinord.ee",
    certifications: ["EN 1090-2 EXC2", "ISO 3834-3"],
    sourceUrl: "https://polinord.ee/en/", sourceName: "polinord.ee (company site)" },
  { name: "HANZA Mechanics Tartu AS", country: "EE", city: "Vahi, Tartu County", category: CNC,
    description: "Contract manufacturer in the Swedish HANZA group offering CNC turning and 4- and 5-axis milling in steel, stainless steel, aluminium, brass and plastics, together with sheet metal work, cable harness and assembly services.",
    website: "https://hanza.com/manufacturing-clusters/cluster-baltics/hanza-mechanics-tartu/",
    certifications: ["ISO 9001", "ISO 14001", "ISO 45001", "ISO 3834-2"],
    sourceUrl: "https://estonianexport.ee/directory/listing/hanza-mechanics-tartu-as/", sourceName: "Estonian Export Directory" },
  // -------------------------------------------------------- Latvia (batch 2)
  { name: "MetUp SIA", country: "LV", city: "Ventspils", category: STEEL,
    description: "Certified steel fabricator in Ventspils providing steel structure fabrication, welding and CNC machining for construction and industrial clients in the Baltics, Scandinavia and Central and Western Europe, with controlled welding procedures, NDT inspection and CE-marked delivery.",
    website: "https://www.metup.lv",
    certifications: ["EN 1090-2 EXC2", "ISO 9001"],
    sourceUrl: "https://www.metup.lv/certifications", sourceName: "metup.lv (company site)" },
  { name: "East Metal SIA", country: "LV", city: "Daugavpils", category: WELD,
    description: "Danish-owned metal fabrication company with its main manufacturing in three Latvian factories, including Daugavpils and Dobele, specializing in welded metal products in steel, stainless steel and aluminium.",
    website: "https://www.eastmetal.com",
    certifications: ["ISO 9001", "ISO 3834-2", "EN 1090", "EN 15085-2"],
    sourceUrl: "https://www.eastmetal.com/en/competences/certificates-2/", sourceName: "eastmetal.com (company site)" },
  { name: "UPB AS", country: "LV", city: "Liepāja", category: STEEL,
    description: "Latvian engineering and manufacturing group with factories and offices in Liepāja, Riga, Grobiņa and Daugavpils, producing and installing steel, precast concrete and glazed structures for export markets; group companies certified to ISO 9001/14001/45001 since 2000, with NORSOK-compliant products and CE marking.",
    website: "https://www.upb.lv",
    certifications: ["ISO 9001", "ISO 14001", "ISO 45001"],
    sourceUrl: "https://www.upb.lv/en/sustainability/quality", sourceName: "upb.lv (company site)" },
  // -------------------------------------------------------------- Poland
  { name: "Weldon Sp. z o.o.", country: "PL", category: STEEL,
    description: "Polish manufacturer of steel structures, noise barriers, electricity pylons, modular buildings and containers, with over 20 years of industrial experience across Europe. Welding quality system certified to PN-EN ISO 3834-2 and factory production control to PN-EN 1090 up to execution class EXC3.",
    website: "https://weldon.eu",
    certifications: ["ISO 9001:2015", "ISO 14001:2015", "ISO 45001:2018", "AQAP 2110:2016", "PN-EN ISO 3834-2:2021", "PN-EN 1090-1+A1:2012", "PN-EN 1090-2:2018 (EXC3)"],
    sourceUrl: "https://weldon.eu/", sourceName: "weldon.eu (company site)" },
  { name: "KBR Poland", country: "PL", city: "Kwidzyn", yearFounded: 1994, category: WELD,
    description: "Industrial services enterprise on the European market since 1994: maintenance, installations and start-ups, plus fabrication of industrial equipment. Steel structures manufactured to PN-EN 1090-1 and PN-EN ISO 3834-2; IWE/EWE-certified welding supervisors, 100+ qualified welding procedures (WPQR) and an in-house welding school.",
    website: "https://www.kbr-poland.com",
    certifications: ["PN-EN 1090-1", "PN-EN ISO 3834-2"],
    sourceUrl: "https://www.kbr-poland.com/en/steel-structures", sourceName: "kbr-poland.com (company site)" },
  { name: "Elektron Sp. z o.o.", country: "PL", yearFounded: 2018, category: WELD,
    description: "Metal processing company in the Podkarpackie region offering laser cutting, sheet metal bending, pipe and profile bending, MIG/MAG/TIG welding and powder coating in a facility of over 3,500 m² with more than 100 specialists.",
    website: "https://webelektron.com",
    certifications: ["ISO 9001", "ISO 3834", "EN 1090 EXC3"],
    sourceUrl: "https://webelektron.com/about-us/", sourceName: "webelektron.com (company site)" },
  { name: "BUD-INVEST Steel", country: "PL", city: "Tczew", category: PIPE,
    description: "Designs, prefabricates and installs steel structures, industrial pipelines and pressure vessels from its own facility in Tczew, with workshop prefabrication and on-site assembly for chemical, petrochemical, energy, offshore and shipbuilding customers in Poland and Germany.",
    website: "https://budinvest-steel.com",
    certifications: ["EN 1090", "EN ISO 3834"],
    sourceUrl: "https://budinvest-steel.com/en/about", sourceName: "budinvest-steel.com (company site)" },
  { name: "HML Nosewicz", country: "PL", city: "Lidzbark Warmiński", category: STAINLESS,
    description: "Manufacturer of stainless and carbon steel pressure and non-pressure tanks, reactors, industrial mixers and heat exchangers for the pharmaceutical, cosmetics, food, energy and chemical industries, with conformity certificates from notified bodies (UDT, TÜV) for pressure equipment.",
    website: "https://hmlnosewicz.pl",
    certifications: ["ISO 9001:2015", "ISO 3834-2:2005", "ASME Sec VIII div 1", "U-Stamp"],
    sourceUrl: "https://hmlnosewicz.pl/en/quality-control/", sourceName: "hmlnosewicz.pl (company site)" },
  { name: "Radmot Sp. z o.o.", country: "PL", city: "Jedlińsk", category: CNC,
    description: "CNC turning and milling subcontractor with over 40 years of experience, operating close to 90 CNC machine tools with more than 200 employees and 22 measuring machines guaranteeing accuracy to 0.005 mm, serving automotive, electrical and mechanical engineering industries.",
    website: "https://radmot.com",
    certifications: ["ISO 9001:2015", "IATF 16949", "ISO 14001:2015"],
    sourceUrl: "https://radmot.com/cnc-company", sourceName: "radmot.com (company site)" },
  { name: "CNC ALFA", country: "PL", city: "Radom", category: CNC,
    description: "Family-owned company in Radom providing precise and complex CNC machining services, including CNC milling, CNC turning and wire EDM, manufactured in accordance with ISO 9001:2015 certified by TÜV Rheinland.",
    website: "https://www.cncalfa.pl",
    certifications: ["ISO 9001:2015"],
    sourceUrl: "https://www.cncalfa.pl/en/quality", sourceName: "cncalfa.pl (company site)" },
  { name: "Vistal Gdynia S.A.", country: "PL", city: "Gdynia", yearFounded: 1991, category: STEEL,
    description: "Producer of steel structures active on the European market since 1991, with more than 25 years of experience building steel bridges and structures for the civil, energy, shipbuilding and offshore industries; manufacturing, assembly, corrosion protection and NDT testing facilities.",
    certifications: ["PN-EN 1090-1:2012 (EXC4)", "PN-EN ISO 3834-2"],
    sourceUrl: "https://www.environmental-expert.com/companies/vistal-gdynia-sa-60578", sourceName: "Environmental Expert (directory)" },
  { name: "ZMK WOSTAL Sp. z o.o.", country: "PL", city: "Wolbrom", category: WELD,
    description: "Mechanical and forging works in Wolbrom with nearly 100 years of history, producing steel and aluminium die forgings, welded steel structures, CNC machined parts and laser, plasma and oxygen cutting, with over 200 employees across three production departments.",
    website: "https://wostal.pl",
    certifications: ["DIN EN ISO 3834-2", "EN 17460"],
    awards: ["Diamenty Forbesa 2026"],
    sourceUrl: "https://wostal.pl/", sourceName: "wostal.pl (company site)" },
  { name: "Stal Impex Sp. z o.o.", country: "PL", city: "Krosno", yearFounded: 1997, category: WELD,
    description: "Manufacturer of welded steel tubes, closed profiles and angles since 1997, headquartered in Krosno with a tube production plant in Gorlice and five technological production lines; pipe processing services include laser tube cutting, CNC tube bending and welding.",
    website: "https://www.stalimpex.eu",
    awards: ["Gazele Biznesu", "Gepardy Biznesu", "Diamenty Forbesa"],
    sourceUrl: "https://www.stalimpex.eu/us/about-us/", sourceName: "stalimpex.eu (company site)" },
  // ------------------------------- Lithuania — construction trades
  { name: "UAB Litimbera", country: "LT", category: "Carpentry & joinery",
    description: "Litimbera is a Lithuanian wood processing and carpentry manufacturer producing prefabricated timber-framed panel houses, roof trusses, industrial buildings, structural timber elements and exterior lining boards. Its joinery and carpentry output is supplied to private and commercial projects in Lithuania, Latvia, Sweden, Iceland and Norway. The company cooperates with Lithuanian forest enterprises for its timber supply.",
    website: "https://www.litimbera.lt",
    sourceUrl: "https://www.litimbera.lt/en", sourceName: "Litimbera company website" },
  { name: "Roofmaster (roofmaster.lt)", country: "LT", city: "Vilnius", category: "Roofing",
    description: "Roofmaster is a Vilnius-based flat roofing contractor working with bitumen roll roofing, PVC and TPO membrane roofs and polyurethane roofs. Its seasonal roofing team includes more than 45 certified roofers together with civil engineers, construction supervisors and technologists with international experience across the Baltics and Norway. The company states it works in accordance with ISO 9001, ISO 14001 and ISO 45001 management standards and provides civil liability insurance of up to EUR 1 million during roofing works.",
    website: "https://roofmaster.lt",
    certifications: ["ISO 9001:2015", "ISO 14001:2015", "ISO 45001:2018"],
    sourceUrl: "https://roofmaster.lt/en/about/", sourceName: "Roofmaster company website" },
  { name: "UAB Ulpas", country: "LT", city: "Alytus", yearFounded: 1994, category: "Plumbing & HVAC",
    description: "Ulpas is a supplier and installer of heating, ventilation, air conditioning (HVAC) and plumbing solutions for private and business clients. The company provides materials, equipment, design services, installation and technical maintenance, and is the regional representative of several European HVAC equipment manufacturers in Southern Lithuania. With operations beginning in 1994, its teams carry out plumbing and HVAC projects in Lithuania as well as Latvia, Sweden, Germany and Norway.",
    website: "https://ulpas.lt",
    sourceUrl: "https://ulpas.lt/en/pradzia-english/", sourceName: "Ulpas company website" },
  { name: "UAB Ardega", country: "LT", city: "Kaunas", yearFounded: 1999, category: "Plumbing & HVAC",
    description: "Ardega is a Kaunas company whose specialists work in the field of gas, industrial and domestic heating, ventilation and air conditioning (HVAC) systems. Its activity covers high, medium and low pressure gas pipelines, boiler houses and HVAC equipment, together with start-up, commissioning, spare parts supply and warranty and post-warranty servicing of this pipework and plumbing equipment. The company states that its quality management system is certified to EN ISO 9001:2015 and its environmental management system complies with EN ISO 14001.",
    website: "https://ardega.lt",
    certifications: ["EN ISO 9001:2015", "EN ISO 14001"],
    sourceUrl: "https://ardega.lt/en/about-us/", sourceName: "Ardega company website" },
  { name: "UAB Litnobiles", country: "LT", city: "Vilnius", yearFounded: 1998, category: "Painting & surface treatment",
    description: "Litnobiles describes itself as one of the largest providers of anti-corrosive solutions in the Baltic states. Its work covers surface treatment that removes pollutants and oxides and roughens the surface to slow corrosion, alongside protective coating audits, recommendations for protective systems, and projects for powder-coating and liquid-painting lines, plus training and supply of equipment for those painting systems. The company states its inspectors hold the highest level FROSIO certificate (level III).",
    website: "https://litnobiles.lt",
    certifications: ["FROSIO Level III (inspectors)"],
    sourceUrl: "https://litnobiles.lt/en/apie-imone/", sourceName: "Litnobiles company website" },
  { name: "UAB Autokausta", country: "LT", city: "Kaunas", yearFounded: 1997, category: "Groundworks & excavation",
    description: "Autokausta is one of the larger Lithuanian construction and road building companies, based in Kaunas, and also manufactures ready-mixed concrete and asphalt. Its project work covers groundworks, earthwork and road laying as well as general construction in Kaunas and across Lithuania. The company publishes management system certificates covering ISO 9001, ISO 14001 and ISO 45001, and has been awarded the Lithuanian \"Stipriausi Lietuvoje\" (Strongest in Lithuania) certificate.",
    website: "https://www.autokausta.lt",
    certifications: ["LST EN ISO 9001:2015", "ISO 14001", "ISO 45001"],
    awards: ["Stipriausi Lietuvoje (Strongest in Lithuania) certificate — 2011, 2012, 2014"],
    sourceUrl: "https://www.autokausta.lt/en/518-2/", sourceName: "Autokausta company website (About us and certificates pages)" },
  { name: "UAB Vilniaus BDT", country: "LT", city: "Vilnius", yearFounded: 2001, category: "Demolition",
    description: "Vilniaus BDT is a Lithuanian demolition contractor whose main activities are demolition of buildings, excavation, drilling, cutting and ripping work, with a growing share of road, site and railway construction. The company recycles construction scrap accumulated during demolition using mobile crushers and sieves, and performs about 90 percent of its work with its own machinery, including demolition and digging excavators. Reference projects include dismantling the skeleton of an unfinished national stadium using explosives and demolishing 250 and 150 metre chimneys at the Elektrenai complex.",
    website: "https://bdt.lt",
    sourceUrl: "https://bdt.lt/en/about-us/", sourceName: "Vilniaus BDT company website" },
  { name: "UAB Linkodas", country: "LT", yearFounded: 2011, category: "Tiling",
    description: "Linkodas is a Lithuanian construction finishing and renovation contractor operating since 2011. Its interior finishing scope includes tiling work covering tile base preparation, tile adhesive application, waterproofing installation and joint grouting, alongside drywall partitions, suspended ceilings and floor installation, plus exterior wall and eaves cladding. The company lists completed projects across Lithuania ranging from logistics complexes and A++ class offices to residential complexes and heritage sites.",
    website: "https://linkodas.lt",
    sourceUrl: "https://linkodas.lt/apdailos-darbai/vidaus-apdaila/plyteliu-klijavimas/", sourceName: "Linkodas company website" },
  { name: "City Service SE", country: "LT", city: "Vilnius", yearFounded: 1997, category: "Property services",
    description: "City Service is a Vilnius-headquartered property services and facility management group, described as the largest provider of facility management services in Lithuania. Its property services cover administration and maintenance of commercial and residential buildings, maintenance and repair of engineering systems, energy resources management and renovation, technical and energy auditing of buildings, territory cleaning and security services. Group companies operate in Lithuania, Latvia, Poland and Spain.",
    website: "https://cityservice.eu",
    sourceUrl: "https://cityservice.eu/about-us/our-company/", sourceName: "City Service company website" },
  { name: "UAB Omnistata", country: "LT", city: "Vilnius", yearFounded: 2003, category: "Concrete works",
    description: "Omnistata is a specialised concrete and resin flooring contractor carrying out industrial floor installation in Lithuania and Scandinavia. Its concrete works include industrial concrete flooring, floor screed installation and industrial coating application using modern equipment and current floor installation technologies. The company has been active in floor installation since 2003 and states it has concreted and poured almost 1,000,000 square metres of floors.",
    website: "https://omnistata.lt",
    sourceUrl: "https://omnistata.lt/en/about-us/", sourceName: "Omnistata company website" },
  { name: "UAB Vekada", country: "LT", city: "Panevėžys", yearFounded: 1994, category: "Electrical installation",
    description: "Vekada is a Panevezys-based contractor specialising in electrical installation and electrical mounting works. Its services include indoor electrical installation, signalling systems and installation of solar power plants. The company states it has implemented an ISO 9001:2015 quality management system, an ISO 14001:2015 environmental management system and an OHSAS 18001:2007 occupational health and safety management system.",
    website: "https://www.vekada.lt",
    certifications: ["ISO 9001:2015", "ISO 14001:2015", "OHSAS 18001:2007"],
    sourceUrl: "https://www.vekada.lt/", sourceName: "Vekada company website" },
  // ---------------------------------- Latvia — construction trades
  { name: "Roofmaster (roofmaster.lv)", country: "LV", city: "Riga", yearFounded: 2002, category: "Roofing",
    description: "Roofmaster is a Latvian roofing contractor specialising in flat roofs, covering construction, repair, restoration and insulation of flat roofing as well as full roof diagnostics. The company runs its own sheet-metal parts production and roofing materials logistics, and works with a seasonal team of certified roofers supported by civil engineers, construction supervisors and technologists. Its roofing references include retail chains, utilities, industrial clients and Riga Airport.",
    website: "https://roofmaster.lv/en/",
    certifications: ["ISO 9001:2015", "ISO 14001:2015", "ISO 45001:2018"],
    sourceUrl: "https://roofmaster.lv/en/about-roofmaster/", sourceName: "Roofmaster company website — About us" },
  { name: "Primekss", country: "LV", city: "Riga", category: "Concrete works",
    description: "Primekss is a Riga-based concrete technology company that began as a concrete contractor and developed PrimX, a patented steel fibre reinforced self-stressing concrete system. Its concrete works produce jointless, dimensionally stable industrial concrete floors and structural elements. The company operates its own concrete research centre and has subsidiaries in ten countries.",
    website: "https://primekss.com/",
    sourceUrl: "https://primekss.com/about-us/about-company", sourceName: "Primekss website — About the company" },
  { name: "BIANT", country: "LV", city: "Riga", category: "Plumbing & HVAC",
    description: "BIANT is a Latvian engineering systems contractor in Riga performing HVAC installation together with plumbing work such as interior water supply and sewage networks. Services span HVAC consulting, installation, project management, commissioning and maintenance of mechanical systems. Its reference projects include the National Library of Latvia and Arena Riga.",
    website: "https://www.biant.lv/en/",
    certifications: ["ISO 9001"],
    sourceUrl: "https://www.biant.lv/en/company/history/", sourceName: "BIANT website — Company history" },
  { name: "KRASO", country: "LV", city: "Riga", yearFounded: 2000, category: "Painting & surface treatment",
    description: "KRASO is a Latvian paint retailer, manufacturer and wholesaler that also provides painting and construction services, with painting as its specialisation for more than twenty years. Its craft team of roughly 60 trained workers carries out puttying of walls and ceilings, painting, decorative painting, plastering, wallpapering, gypsum wall installation and wall and floor tiling. The company operates paint shops and warehouses in Riga, Daugavpils and Liepaja.",
    website: "https://www.kraso.com/en/",
    sourceUrl: "https://www.kraso.com/en/about-kraso/", sourceName: "KRASO website — About KRASO" },
  { name: "Flizesanas serviss", country: "LV", category: "Tiling",
    description: "Flizesanas serviss is a Latvian contractor dedicated to tiling works, delivering a full service from consultation through surface preparation to finished tile installation. Its tiling covers apartments and offices, wet rooms with professional waterproofing, weather-resistant outdoor tiling, and production, storage and commercial spaces. The team works with ceramic, porcelain, natural stone and glass tiles, and also restores or replaces damaged tiling.",
    website: "https://www.flizesanasserviss.lv/",
    sourceUrl: "https://www.flizesanasserviss.lv/", sourceName: "Flizesanas serviss company website" },
  // --------------------------------- Estonia — construction trades
  { name: "Timbeco Woodhouse OÜ", country: "EE", city: "Tõdva", yearFounded: 1993, category: "Carpentry & joinery",
    description: "Timbeco Woodhouse is an Estonian-capital factory producing prefabricated timber-frame elements, element buildings and modular buildings, work carried out as factory carpentry and joinery on CNC robotic lines. Prefabricated element production has been its main focus since 1993 and it has erected more than 3500 buildings in 25 countries. Around 95% of output is exported to Finland, Sweden, Norway, Switzerland and Japan, and production follows Norwegian TEK17, Swedish and Finnish Eurocode 5 rules.",
    website: "https://timbeco.ee/en/",
    certifications: ["ISO 9001:2015", "CE marking", "Ü-Mark (DIN 1052-11)"],
    sourceUrl: "https://timbeco.ee/en/about-the-company/", sourceName: "Timbeco Woodhouse website — About us" },
  { name: "Aspen Grupp OÜ", country: "EE", city: "Saku", yearFounded: 2005, category: "Demolition",
    description: "Aspen Grupp is an Estonian-capital company specialising in the demolition of buildings, from large industrial complexes, viaducts and bridges to smaller auxiliary buildings, and also carrying out internal demolition. It crushes demolition waste on site into CE-marked recyclable aggregates that are reused as fill or sold. The company additionally performs excavation and earthworks and rents out machinery, operating mainly in Estonia and Finland and across the Baltic States.",
    website: "https://aspen.ee/en/",
    sourceUrl: "https://aspen.ee/en/about-us/", sourceName: "Aspen website — About us" },
  { name: "AS Connecto Eesti", country: "EE", city: "Tallinn", category: "Electrical installation",
    description: "Connecto Eesti designs, builds and maintains electricity, telecommunications and gas networks in the Baltics. Its electrical installation expertise covers high-voltage networks, low and medium voltage networks, telecommunications networks, gas networks, geodesy and design, and green energy solutions. The company operates a high-voltage laboratory accredited by the Estonian Accreditation Centre for measurement of electrical installations and testing of electrical equipment.",
    website: "https://www.connecto.ee/en/",
    certifications: ["ISO 9001:2015", "ISO 14001:2015", "ISO 45001:2018", "EVS-EN ISO/IEC 17025:2017 (accredited laboratory)", "EVS-EN ISO/IEC 17020:2012 (accredited laboratory)"],
    sourceUrl: "https://www.connecto.ee/en/", sourceName: "Connecto Eesti company website" },
  { name: "Verston Eesti OÜ", country: "EE", city: "Tallinn", yearFounded: 2010, category: "Groundworks & excavation",
    description: "Verston Eesti is an Estonian infrastructure and road construction company whose work covers groundworks and earthworks for highways, streets and other infrastructure projects. It integrates road construction, design and maintenance into full-cycle solutions for public and private sector clients. The company is one of the market leaders in Estonian infrastructure construction and maintenance.",
    website: "https://verston.ee/",
    certifications: ["ISO 9001:2015", "ISO 14001:2015", "ISO 45001:2018"],
    sourceUrl: "https://verston.ee/meist/", sourceName: "Verston Eesti website — About us" },
  { name: "Kinnisvarateenindus OÜ", country: "EE", city: "Tallinn", yearFounded: 1993, category: "Property services",
    description: "Kinnisvarateenindus is an Estonian property services company providing complete real estate maintenance and management, with offices across Estonia and almost 700 employees. Its third-class maintenance and management certificate confirms competence in property maintenance, interior cleaning, general construction maintenance and the upkeep of technical systems. The company has operated since 1993 and works to the Estonian real estate maintenance standard EVS 807:2016.",
    website: "https://kinnisvarateenindus.ee/en/",
    certifications: ["ISO 9001:2015", "EVS 807:2016"],
    sourceUrl: "https://kinnisvarateenindus.ee/en/about-us/", sourceName: "Kinnisvarateenindus website — About us" },
  // ---------------------------------- Poland — construction trades
  { name: "Eko-Okna S.A.", country: "PL", city: "Pietrowice Wielkie", yearFounded: 1998, category: "Carpentry & joinery",
    description: "Eko-Okna S.A. is a Polish manufacturer of windows, doors, roller shutters and gates, producing joinery in PVC, aluminium, steel and wood. Its wooden carpentry and joinery output is covered by ISO 9001 quality management and ISO 14001 environmental management certificates. Production runs in plants at Kornice and Raciborz, with products sold across dozens of export markets.",
    website: "https://ekookna.pl",
    certifications: ["ISO 9001", "ISO 14001"],
    sourceUrl: "https://ekookna.pl/ekopl/aktualnosci/potwierdzona-jakosc-i-ekologia-nasza-stolarka-drewniana-z-certyfikatami-iso-9001-i-14001", sourceName: "Eko-Okna S.A. company news - ISO 9001 and ISO 14001 for wooden joinery" },
  { name: "Dachland Sp. z o.o.", country: "PL", city: "Olsztyn", yearFounded: 1992, category: "Roofing",
    description: "Dachland Sp. z o.o. is an Olsztyn-based construction company specialising in complete roofing work on both pitched and flat roofs, including metal roof tile installation, insulation and sheet-metal flashing. Alongside specialist roofing it operates as a general contractor and sells building materials. The company has been listed among the laureates of the Gazele Biznesu ranking of fast-growing Polish SMEs.",
    website: "https://dachland.pl",
    awards: ["Gazele Biznesu"],
    sourceUrl: "https://dachland.pl/o-nas/", sourceName: "Dachland Sp. z o.o. company website (O nas / Gazele Biznesu news)" },
  { name: "Zaklad Uslugowo-Handlowy SANITEX", country: "PL", city: "Krakow", yearFounded: 1999, category: "Plumbing & HVAC",
    description: "SANITEX is a Krakow-based installation contractor that has operated since 1999, carrying out plumbing and sanitary works covering water supply, sewage, gas and central heating systems. It also delivers HVAC installations including mechanical ventilation and air conditioning. The firm builds complete boiler rooms and installs radiator, underfloor and channel heating for clients in Krakow and across the Malopolska region.",
    website: "https://www.zuh-sanitex.pl",
    sourceUrl: "https://www.zuh-sanitex.pl/", sourceName: "SANITEX company website" },
  { name: "Alucrom Sp. z o.o.", country: "PL", city: "Wroclaw", yearFounded: 2003, category: "Painting & surface treatment",
    description: "Alucrom is a Polish-Swedish surface treatment company operating in Poland since 2003, providing industrial painting and anti-corrosion protection for steel structures. It runs industrial paint shops near Wroclaw and near Kielce, covering the full process from surface preparation to protective coating, including powder painting, thermal spray metallising and E-coat. Its painting and coating work is certified to ISO 9001:2015 and ISO 14001:2015, and the company also holds IATF 16949.",
    website: "https://alucrom.pl",
    certifications: ["ISO 9001:2015", "ISO 14001:2015", "IATF 16949"],
    sourceUrl: "https://alucrom.pl/", sourceName: "Alucrom Sp. z o.o. company website" },
  { name: "Patyra Budownictwo Sp. z o.o.", country: "PL", city: "Lublin", yearFounded: 1992, category: "Groundworks & excavation",
    description: "Patyra Budownictwo is a Lublin-based contractor that has specialised in groundworks and excavation since 1992, including foundation excavation, embankment construction and securing of excavations. It also performs mechanical and chemical soil stabilisation to increase ground bearing capacity, pile foundations, road works and sanitary works. The company runs its own sand quarry and machinery fleet and employs between 51 and 200 people.",
    website: "https://patyra.pl",
    sourceUrl: "https://patyra.pl/o-firmie/", sourceName: "Patyra Budownictwo company website (O firmie)" },
  { name: "Przedsiebiorstwo Wielobranzowe POL-ZLOM", country: "PL", city: "Nowa Wies", yearFounded: 1991, category: "Demolition",
    description: "POL-ZLOM has operated since 1991 and provides demolition and dismantling services for halls, warehouses, factories and public utility buildings, with every demolition finished by site clearance and removal of rubble and waste. It serves both private customers and industrial plants and also runs scrap metal collection and sales. The company obtained ISO 9001:2015 quality management and ISO 14001:2015 environmental management certification in 2015.",
    website: "https://pol-zlom.pl",
    certifications: ["ISO 9001:2015", "ISO 14001:2015"],
    sourceUrl: "https://pol-zlom.pl/", sourceName: "POL-ZLOM company website" },
  { name: "Bloniarz Budownictwo", country: "PL", city: "Zakopane", yearFounded: 2008, category: "Tiling",
    description: "Bloniarz Budownictwo has worked in the construction industry since 2008 and specialises in tiling and floor-laying, cutting and installing ceramic, stoneware and large-format tiles on floors and wall claddings. Its tiling contracts have covered hotels, apartments, shopping galleries, shops, office buildings, a school swimming pool with systemic waterproofing and historic buildings restored under heritage conservation supervision. The company works across southern Poland, mainly Podhale, Krakow and the wider Malopolska region, and gives a long-term warranty on its work.",
    website: "https://www.bloniarzbudownictwo.pl",
    sourceUrl: "https://www.bloniarzbudownictwo.pl/", sourceName: "Bloniarz Budownictwo company website" },
  { name: "MAVIKA Facility Management Sp. z o.o.", country: "PL", city: "Krakow", category: "Property services",
    description: "MAVIKA Facility Management delivers property services and comprehensive technical facility management throughout Poland. Its work covers technical maintenance, servicing, repairs and renovation of building installations and equipment in industrial, logistics, office and commercial facilities. The company is built around a team of experienced facility managers and engineers.",
    website: "https://www.mavikafm.pl",
    sourceUrl: "https://www.mavikafm.pl/", sourceName: "MAVIKA Facility Management company website" },
];

/** Later-sourced public facts for already-imported profiles (see importer) */
const ENRICHMENTS: CatalogEnrichment[] = [
  // Lithuania
  { name: "Westa Steel UAB", city: "Mažeikiai", yearFounded: 2014,
    sourceUrl: "https://www.westasteel.lt/en/about-us/", sourceName: "westasteel.lt (company site)" },
  { name: "Rokvelas UAB", certifications: ["ISO 9001", "EN 1090-1", "EN 1090-2 EXC3"], city: "Panevėžys", yearFounded: 2004, website: "https://rokvelas.lt",
    sourceUrl: "https://www.europages.co.uk/ROKVELAS-UAB/00000003657703-000020534001.html", sourceName: "Europages profile" },
  { name: "Lavango Engineering LT UAB", city: "Klaipėda",
    sourceUrl: "https://www.dnb.com/business-directory/company-profiles.lavango_engineering_lt_uab.decee450438ba0b4431977a9e2f5836f.html", sourceName: "Dun & Bradstreet profile" },
  { name: "Anvalda UAB", city: "Vilnius", website: "https://www.anvalda.com",
    sourceUrl: "https://www.anvalda.com/", sourceName: "anvalda.com (company site)" },
  { name: "GRR Engineering UAB", city: "Utena", yearFounded: 2010, website: "https://www.grr.lt",
    sourceUrl: "https://www.info.lt/en/imones/GRR-Engineering-UAB/2296135", sourceName: "Info.lt company profile" },
  { name: "Stansefabrikken Automotive UAB", certifications: ["ISO 9001:2015", "ISO 14001:2015", "ISO 45001:2018"], city: "Ukmergė", website: "https://www.stansefabrikken.com/StansefabrikkenAutomotive/",
    sourceUrl: "https://www.stansefabrikken.com/StansefabrikkenUkmerge/quality/", sourceName: "Stansefabrikken quality page" },
  { name: "Martema UAB", certifications: ["ISO 9001:2015"], city: "Marijampolė", website: "https://www.martema.lt",
    sourceUrl: "https://www.martema.lt/en/", sourceName: "martema.lt (company site)" },
  { name: "OSS UAB", certifications: ["ISO 9001", "ISO 14001", "ISO 45001", "ISO 3834-2", "EN ISO 9606-1:2013 (welder qualifications)"],
    sourceUrl: "https://www.oss.lt/quality", sourceName: "oss.lt quality page" },
  { name: "Feliuga UAB", certifications: ["ISO 9001", "EN 1090-1+A1"], city: "Klaipėda", website: "https://feliuga.lt",
    sourceUrl: "https://feliuga.lt/quality/", sourceName: "feliuga.lt quality page" },
  { name: "Western Baltija Shipbuilding UAB", yearFounded: 2010,
    sourceUrl: "https://wbs.lt/en/history/", sourceName: "wbs.lt (company site)" },
  { name: "Marine Technology (Western Shipyard Group)", certifications: ["ISO 9001", "ISO 14001", "ISO 45001", "EN 1090 EXC4", "EN 13445"], website: "https://marinetechnology.lt",
    sourceUrl: "https://lt.linkedin.com/company/mtechnology", sourceName: "LinkedIn company page" },
  // Latvia
  { name: "Ritausmas Steel Constructions SIA", certifications: ["EN 1090", "EN 3834"],
    sourceUrl: "https://ritausmas.lv/en/", sourceName: "ritausmas.lv (company site)" },
  { name: "Industrial Welding SIA", certifications: ["DIN EN 1090", "DIN EN ISO 3834", "EN 15085"], city: "Daugavpils", yearFounded: 2016,
    sourceUrl: "https://www.techpilot.com/en/profiles/sia-industrial-welding", sourceName: "Techpilot supplier profile" },
  { name: "EMJ Metals SIA", certifications: ["ISO 9001", "ISO 14001", "ISO 50001", "AQAP"], yearFounded: 2010,
    sourceUrl: "https://www.bmeopensourcing.com/en/supplier-profile/10634/emj-metals-sia", sourceName: "BME OpenSourcing supplier profile" },
  { name: "Metal Constructions (metals.lv)", certifications: ["EN 1090"],
    sourceUrl: "https://metals.lv/en/steel-metal-constructions/metalworking/", sourceName: "metals.lv (company site)" },
  { name: "CNC Latvia Ltd", certifications: ["ISO 9001:2015"],
    sourceUrl: "https://cnclatvia.com/", sourceName: "cnclatvia.com (company site)" },
  { name: "Metalmeistars Ltd", city: "Liepāja",
    sourceUrl: "https://www.metal.lv/en", sourceName: "metal.lv (company site)" },
  { name: "AB Metal Ltd", city: "Liepāja",
    sourceUrl: "https://www.metal.lv/en", sourceName: "metal.lv (company site)" },
  // Estonia
  { name: "AGMA OÜ", certifications: ["EN ISO 3834-2", "EN 1090-1 EXC3"], website: "http://agma.ee/en/",
    sourceUrl: "https://www.europages.co.uk/AGMA/00000003878045-298430001.html", sourceName: "Europages listing" },
  { name: "Monik OÜ", certifications: ["EN 1090-2 EXC4", "EN ISO 3834-2", "ISO 9001:2015", "ISO 14001:2015"],
    sourceUrl: "https://www.monik.ee/", sourceName: "monik.ee (company site)" },
  { name: "Bernal Estonia OÜ", city: "Tallinn", yearFounded: 2010,
    sourceUrl: "https://bernal.ee/en/", sourceName: "bernal.ee (company site)" },
  { name: "Steel Element OÜ", certifications: ["EN 1090-2 EXC3", "ISO 3834-2:2021", "ISO 9001:2015"],
    sourceUrl: "https://steelelement.ee/en/", sourceName: "steelelement.ee (company site)" },
  { name: "Metalset OÜ", city: "Tallinn",
    sourceUrl: "https://flagma.com.ee/en/1963997/", sourceName: "Flagma company listing" },
  { name: "Levstal Group", certifications: ["ISO 9001:2015", "EN 1090-2 EXC3", "EN ISO 3834-2", "PED 2014/68/EU (Annex I, 3.1)"], yearFounded: 1991,
    sourceUrl: "https://levstal.com/", sourceName: "levstal.com (company site)" },
  { name: "Scanweld AS", certifications: ["EN 3834-2", "EN 1090-1 EXC2"], yearFounded: 1991,
    sourceUrl: "https://www.scanweld.ee/about-us/company/certificates/", sourceName: "scanweld.ee certificates page" },
  { name: "Radius Machining OÜ", certifications: ["ISO 9001:2015", "ISO 14001:2015"], website: "https://www.radius.ee",
    sourceUrl: "https://www.radius.ee/en/about-us/quality-and-environment", sourceName: "radius.ee (company site)" },
];

async function main() {
  const admin = await db.query.users.findFirst({
    where: eq(users.email, "admin@piotrr.example"),
  });
  if (!admin) throw new Error("Run npm run db:seed first");

  let created = 0;
  for (const entry of CATALOG) {
    const existing = await db.query.companies.findFirst({
      where: and(
        eq(companies.name, entry.name),
        eq(companies.country, entry.country),
      ),
    });
    if (existing) continue;

    await db.transaction(async (tx) => {
      const [company] = await tx
        .insert(companies)
        .values({
          name: entry.name,
          country: entry.country,
          city: entry.city,
          description: entry.description,
          website: entry.website,
          yearFounded: entry.yearFounded,
          category: entry.category,
          claimStatus: "unclaimed",
          sourceUrl: entry.sourceUrl,
          sourceName: entry.sourceName,
          languages: [],
          certifications: entry.certifications ?? [],
          awards: entry.awards ?? [],
        })
        .returning();
      if (!company) throw new Error("insert failed");

      await tx.insert(companySlugs).values({
        companyId: company.id,
        slug: slugify(entry.name, entry.country),
      });
      await writeAudit(tx, {
        actorId: admin.id,
        entityType: "company",
        entityId: company.id,
        action: "company.imported_from_open_source",
        after: { sourceUrl: entry.sourceUrl, sourceName: entry.sourceName },
      });
      await appendOutbox(tx, "companies.imported", { companyId: company.id });
    });
    created += 1;
  }

  // Enrichment: apply later-sourced facts to already-imported profiles.
  // Only fills fields, never downgrades claim status or touches ownership.
  let enriched = 0;
  for (const patch of ENRICHMENTS) {
    const existing = await db.query.companies.findFirst({
      where: eq(companies.name, patch.name),
    });
    if (!existing) continue;

    const set: Record<string, unknown> = {};
    if (patch.certifications?.length) set.certifications = patch.certifications;
    if (patch.awards?.length) set.awards = patch.awards;
    if (patch.city && !existing.city) set.city = patch.city;
    if (patch.yearFounded && !existing.yearFounded) set.yearFounded = patch.yearFounded;
    if (patch.website && !existing.website) set.website = patch.website;
    if (Object.keys(set).length === 0) continue;

    await db.transaction(async (tx) => {
      await tx
        .update(companies)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(companies.id, existing.id));
      await writeAudit(tx, {
        actorId: admin.id,
        entityType: "company",
        entityId: existing.id,
        action: "company.enriched_from_open_source",
        before: {
          certifications: existing.certifications,
          awards: existing.awards,
        },
        after: { ...set, sourceUrl: patch.sourceUrl, sourceName: patch.sourceName },
      });
    });
    enriched += 1;
  }

  logger.info(
    `catalog seed complete: ${created} new unclaimed profiles (${CATALOG.length} total in catalog), ${enriched} enriched`,
  );
  await pool.end();
}

main().catch((error) => {
  logger.error(error, "catalog seed failed");
  process.exit(1);
});
