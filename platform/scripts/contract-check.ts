/**
 * Live contract check: the wire against the schema.
 *
 *   BASE=http://127.0.0.1:3100 npx tsx scripts/contract-check.ts
 *
 * `openapi.test.ts` proves every route is documented; the route handlers
 * parse their own output. This closes the remaining gap — that a client
 * following the *published document* receives exactly what it promises —
 * by fetching the real endpoints over HTTP and validating the payloads
 * against the same Zod schemas the document is generated from. Each
 * check carries a positive control: a checker that cannot fail proves
 * nothing.
 */
import { catalogResponseSchema, suppliersResponseSchema } from "@/lib/api-schemas";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
let passed = 0;
const failures: string[] = [];

function ok(label: string) {
  passed += 1;
  console.log(`  ok   ${label}`);
}
function fail(label: string, detail: string) {
  failures.push(label);
  console.log(`  FAIL ${label}\n       ${detail}`);
}

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) throw new Error(`${path} -> content-type ${type}`);
  return res.json();
}

async function main() {
  // ---- the catalog ----
  const catalog = await fetchJson("/api/v1/catalog");
  const catParsed = catalogResponseSchema.safeParse(catalog);
  if (catParsed.success) {
    ok("GET /api/v1/catalog matches its published schema");
    const n = catParsed.data.data.trades.length;
    if (n >= 13) ok(`catalog carries the full trade taxonomy (${n})`);
    else fail("catalog trade count", `expected >= 13 trades, got ${n}`);
    if (catParsed.data.data.corridors.length === 12)
      ok("catalog carries all 12 corridors");
    else fail("catalog corridors", `expected 12, got ${catParsed.data.data.corridors.length}`);
  } else {
    fail("GET /api/v1/catalog", catParsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 3).join("; "));
  }

  // ---- suppliers, plain and filtered ----
  for (const q of ["", "?country=LT", "?verified=1", "?q=welding&limit=5"]) {
    const body = await fetchJson(`/api/v1/suppliers${q}`);
    const parsed = suppliersResponseSchema.safeParse(body);
    if (!parsed.success) {
      fail(`GET /api/v1/suppliers${q}`, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 3).join("; "));
      continue;
    }
    ok(`GET /api/v1/suppliers${q} matches its published schema (${parsed.data.count} hits)`);
    if (parsed.data.count !== parsed.data.data.length) {
      fail(`suppliers${q} count`, `count=${parsed.data.count} but data has ${parsed.data.data.length}`);
    }
    if (q === "?country=LT" && parsed.data.data.some((h) => h.country !== "LT")) {
      fail("country filter", "a non-LT company appeared in a country=LT result");
    } else if (q === "?country=LT") ok("country filter returns only LT");
    if (q === "?verified=1" && parsed.data.data.some((h) => !h.verified)) {
      fail("verified filter", "an unverified company appeared in a verified=1 result");
    } else if (q === "?verified=1") ok("verified filter returns only verified");
    if (q === "?q=welding&limit=5" && parsed.data.count > 5) {
      fail("limit", `asked for 5, got ${parsed.data.count}`);
    } else if (q === "?q=welding&limit=5") ok("limit is honoured");
  }

  // ---- positive control: the checker must be able to fail ----
  const broken = { data: [{ companyId: "not-a-uuid" }], count: 1 };
  if (suppliersResponseSchema.safeParse(broken).success) {
    fail("checker self-test", "the schema accepted a deliberately broken payload");
  } else {
    ok("self-test: a broken payload is rejected");
  }

  // ---- the published document really embeds these schemas ----
  const doc = (await fetchJson("/api/v1/openapi.json")) as {
    paths: Record<string, { get?: { responses: Record<string, { content?: Record<string, { schema?: { properties?: Record<string, unknown> } }> }> } }>;
  };
  const docSchema = doc.paths["/api/v1/suppliers"]?.get?.responses["200"]?.content?.["application/json"]?.schema;
  if (docSchema?.properties && "count" in docSchema.properties) {
    ok("openapi.json publishes the suppliers response schema");
  } else {
    fail("openapi.json", "the suppliers 200 response carries no content schema");
  }

  console.log(
    failures.length === 0
      ? `\nCONTRACT CHECK: ${passed} passed, 0 failed`
      : `\nCONTRACT CHECK FAILED: ${failures.length} failures (${passed} passed)`,
  );
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
