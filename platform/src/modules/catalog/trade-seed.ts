/**
 * The trade catalogue, as seed data.
 *
 * Trades are data, not code (Section 2): the `trades` table is the runtime
 * source of truth, and everything that filters, searches or matches reads
 * it. This constant is what that table is *populated from* — it lives here
 * rather than inside `src/db/seed.ts` so it has exactly one definition, and
 * so one other caller can use it: the prerendered home page.
 *
 * That page lists the categories, and prerendering happens in CI and in
 * `docker build`, where there is no database — the build has no business
 * requiring one. Falling back to the seed list there is not a second
 * source of truth; it is the same list the database was filled from. Ops
 * adding a trade shows up on the home page at the next revalidation, and
 * everywhere else immediately.
 */
export interface TradeSeed {
  slug: string;
  nameEn: string;
  nameSv: string;
  nameLt: string;
  nameLv: string;
  nameEt: string;
  namePl: string;
  nameDe: string;
  nameDa: string;
}

export const TRADE_SEED: TradeSeed[] = [
  { slug: "welding", nameEn: "Welding", nameSv: "Svetsning", nameLt: "Suvirinimas", nameLv: "Metināšana", nameEt: "Keevitus", namePl: "Spawanie", nameDe: "Schweißen", nameDa: "Svejsning" },
  { slug: "industrial-fitting", nameEn: "Industrial fitting", nameSv: "Industrimontage", nameLt: "Pramoninis montavimas", nameLv: "Rūpnieciskā montāža", nameEt: "Tööstuslik montaaž", namePl: "Montaż przemysłowy", nameDe: "Industriemontage", nameDa: "Industrimontage" },
  { slug: "carpentry", nameEn: "Carpentry", nameSv: "Snickeri", nameLt: "Staliaus darbai", nameLv: "Galdniecība", nameEt: "Puusepatööd", namePl: "Stolarka", nameDe: "Zimmerei & Tischlerei", nameDa: "Tømrer- og snedkerarbejde" },
  { slug: "painting", nameEn: "Painting", nameSv: "Målning", nameLt: "Dažymas", nameLv: "Krāsošana", nameEt: "Maalritööd", namePl: "Malowanie", nameDe: "Malerarbeiten", nameDa: "Malerarbejde" },
  { slug: "tiling", nameEn: "Tiling", nameSv: "Plattsättning", nameLt: "Plytelių klojimas", nameLv: "Flīzēšana", nameEt: "Plaatimistööd", namePl: "Układanie płytek", nameDe: "Fliesenlegen", nameDa: "Flisearbejde" },
  { slug: "roofing", nameEn: "Roofing", nameSv: "Tak", nameLt: "Stogų darbai", nameLv: "Jumta darbi", nameEt: "Katusetööd", namePl: "Prace dachowe", nameDe: "Dacharbeiten", nameDa: "Tagarbejde" },
  { slug: "concrete", nameEn: "Concrete", nameSv: "Betong", nameLt: "Betonavimas", nameLv: "Betonēšana", nameEt: "Betoonitööd", namePl: "Prace betoniarskie", nameDe: "Betonarbeiten", nameDa: "Betonarbejde" },
  { slug: "electrical", nameEn: "Electrical", nameSv: "El", nameLt: "Elektros darbai", nameLv: "Elektrības darbi", nameEt: "Elektritööd", namePl: "Prace elektryczne", nameDe: "Elektroarbeiten", nameDa: "Elarbejde" },
  { slug: "plumbing-hvac", nameEn: "Plumbing & HVAC", nameSv: "VVS", nameLt: "Santechnika ir ŠVOK", nameLv: "Santehnika un AVK", nameEt: "Torutööd ja ventilatsioon", namePl: "Hydraulika i HVAC", nameDe: "Sanitär & HLK", nameDa: "VVS og ventilation" },
  { slug: "groundworks", nameEn: "Groundworks", nameSv: "Markarbeten", nameLt: "Žemės darbai", nameLv: "Zemes darbi", nameEt: "Mullatööd", namePl: "Roboty ziemne", nameDe: "Erdarbeiten", nameDa: "Jordarbejde" },
  { slug: "steel-structures", nameEn: "Steel structures", nameSv: "Stål", nameLt: "Plieno konstrukcijos", nameLv: "Tērauda konstrukcijas", nameEt: "Teraskonstruktsioonid", namePl: "Konstrukcje stalowe", nameDe: "Stahlbau", nameDa: "Stålkonstruktioner" },
  { slug: "demolition", nameEn: "Demolition", nameSv: "Rivning", nameLt: "Griovimo darbai", nameLv: "Nojaukšanas darbi", nameEt: "Lammutustööd", namePl: "Prace rozbiórkowe", nameDe: "Abbrucharbeiten", nameDa: "Nedrivning" },
  { slug: "property-services", nameEn: "Property services", nameSv: "Fastighetsservice", nameLt: "Pastatų priežiūra", nameLv: "Īpašumu apsaimniekošana", nameEt: "Kinnisvarahooldus", namePl: "Obsługa nieruchomości", nameDe: "Gebäudeservice", nameDa: "Ejendomsservice" },
];
