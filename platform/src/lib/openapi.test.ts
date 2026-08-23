import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createCompanySchema,
  openCaseSchema,
  sendMessageSchema,
  transitionItemSchema,
  uploadRequestSchema,
} from "./api-schemas";
import { buildOpenApiDocument } from "./openapi";
import { registerInputSchema } from "@/modules/identity/service";
import { rfqInputSchema } from "@/modules/rfq/service";
import { offerInputSchema } from "@/modules/offers/service";

/**
 * The spec says it "cannot drift from the code". Half of that was true:
 * request bodies come from the same Zod schemas the routes validate with,
 * so those cannot drift. The *paths* were hand-written, and they had —
 * `/api/metrics` shipped with no entry at all, so a machine reading the
 * contract could not know it exists.
 *
 * This walks the App Router directory, works out which HTTP methods each
 * route actually exports, and requires the document to agree. Adding an
 * endpoint without documenting it now fails here rather than being
 * discovered by whoever integrates against the spec.
 */

const API_ROOT = join(process.cwd(), "src/app/api");

/**
 * Endpoints that exist but stay out of the published contract, each for a
 * stated reason. An exemption is a decision; the list is short on purpose.
 */
const UNDOCUMENTED: Record<string, string> = {
  "/api/v1/openapi.json":
    "the contract itself — describing it inside itself adds nothing",
  "/api/metrics":
    "Prometheus scrape target, not part of the product API: bearer-token " +
    "auth rather than a session, text/plain exposition format, and 404 " +
    "when METRICS_TOKEN is unset",
};

interface DiscoveredRoute {
  path: string;
  methods: string[];
}

function discoverRoutes(dir: string, prefix = "/api"): DiscoveredRoute[] {
  const found: DiscoveredRoute[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // [id] in the filesystem is {id} in an OpenAPI path.
      const segment = entry.replace(/^\[(?:\.\.\.)?(.+)\]$/, "{$1}");
      found.push(...discoverRoutes(full, `${prefix}/${segment}`));
    } else if (entry === "route.ts") {
      const source = readFileSync(full, "utf8");
      const methods = [...source.matchAll(
        /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g,
      )].map((m) => m[1]!);
      if (methods.length > 0) found.push({ path: prefix, methods });
    }
  }
  return found;
}

const document = buildOpenApiDocument(
  {
    createCompany: createCompanySchema,
    register: registerInputSchema,
    rfq: rfqInputSchema,
    openCase: openCaseSchema,
    transitionItem: transitionItemSchema,
    submitOffer: offerInputSchema,
    sendMessage: sendMessageSchema,
    requestUpload: uploadRequestSchema,
  },
  "https://example.test",
);
const paths = document.paths as Record<string, Record<string, unknown>>;
const routes = discoverRoutes(API_ROOT);

describe("OpenAPI document matches the routes that exist", () => {
  it("finds the routes at all (guards against a broken walker)", () => {
    expect(routes.length).toBeGreaterThan(10);
    expect(routes.map((r) => r.path)).toContain("/api/v1/verification/items/{id}");
  });

  it("documents every route, or exempts it with a reason", () => {
    const missing = routes
      .map((r) => r.path)
      .filter((p) => !(p in paths) && !(p in UNDOCUMENTED));
    expect(missing, "routes with no entry in the OpenAPI document").toEqual([]);
  });

  it("documents every method those routes export", () => {
    const wrong: string[] = [];
    for (const route of routes) {
      if (route.path in UNDOCUMENTED) continue;
      const entry = paths[route.path];
      if (!entry) continue; // reported by the test above
      for (const method of route.methods) {
        if (!(method.toLowerCase() in entry)) {
          wrong.push(`${method} ${route.path}`);
        }
      }
    }
    expect(wrong, "methods the code exports but the document omits").toEqual([]);
  });

  it("does not document endpoints that do not exist", () => {
    const real = new Set(routes.map((r) => r.path));
    const phantom = Object.keys(paths).filter((p) => !real.has(p));
    expect(phantom, "documented paths with no route handler").toEqual([]);
  });

  it("does not document methods a route does not export", () => {
    const phantom: string[] = [];
    for (const [path, entry] of Object.entries(paths)) {
      const route = routes.find((r) => r.path === path);
      if (!route) continue;
      for (const method of Object.keys(entry)) {
        if (!route.methods.map((m) => m.toLowerCase()).includes(method)) {
          phantom.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }
    expect(phantom, "documented methods with no exported handler").toEqual([]);
  });
});
