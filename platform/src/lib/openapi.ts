import { z } from "zod";
import { catalogResponseSchema, suppliersResponseSchema } from "@/lib/api-schemas";
import { brand } from "@/lib/brand";

/**
 * OpenAPI 3.1 document generated from the Zod schemas the routes already
 * validate with (Section 4.5), so request bodies cannot drift from the
 * code. The *paths* below are hand-written and could — `/api/metrics`
 * once shipped with no entry at all — so `openapi.test.ts` walks the App
 * Router and fails when a route is added without documenting it, or when
 * a documented path has no handler behind it.
 *
 * Deliberately a small in-house converter rather than a dependency: it
 * covers exactly the Zod constructs this API uses, and Section 8.2 requires
 * asking before adding packages.
 */

type JsonSchema = Record<string, unknown>;

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const def = schema._def as { typeName?: string; [k: string]: unknown };

  switch (def.typeName) {
    case z.ZodFirstPartyTypeKind.ZodObject: {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value as z.ZodTypeAny);
        if (!(value as z.ZodTypeAny).isOptional()) required.push(key);
      }
      return {
        type: "object",
        properties,
        ...(required.length ? { required } : {}),
        additionalProperties: false,
      };
    }
    case z.ZodFirstPartyTypeKind.ZodString: {
      const out: JsonSchema = { type: "string" };
      for (const check of (def.checks ?? []) as { kind: string; value?: number }[]) {
        if (check.kind === "min") out.minLength = check.value;
        if (check.kind === "max") out.maxLength = check.value;
        if (check.kind === "length") { out.minLength = check.value; out.maxLength = check.value; }
        if (check.kind === "uuid") out.format = "uuid";
        if (check.kind === "email") out.format = "email";
        if (check.kind === "url") out.format = "uri";
      }
      return out;
    }
    case z.ZodFirstPartyTypeKind.ZodNumber: {
      const out: JsonSchema = { type: "number" };
      for (const check of (def.checks ?? []) as { kind: string; value?: number }[]) {
        if (check.kind === "int") out.type = "integer";
        if (check.kind === "min") out.minimum = check.value;
        if (check.kind === "max") out.maximum = check.value;
      }
      return out;
    }
    case z.ZodFirstPartyTypeKind.ZodBoolean:
      return { type: "boolean" };
    case z.ZodFirstPartyTypeKind.ZodDate:
      return { type: "string", format: "date-time" };
    case z.ZodFirstPartyTypeKind.ZodEnum:
      return { type: "string", enum: [...(def.values as string[])] };
    case z.ZodFirstPartyTypeKind.ZodArray:
      return { type: "array", items: zodToJsonSchema(def.type as z.ZodTypeAny) };
    case z.ZodFirstPartyTypeKind.ZodOptional:
    case z.ZodFirstPartyTypeKind.ZodNullable:
      return zodToJsonSchema(def.innerType as z.ZodTypeAny);
    case z.ZodFirstPartyTypeKind.ZodDefault: {
      const inner = zodToJsonSchema(def.innerType as z.ZodTypeAny);
      return { ...inner, default: (def.defaultValue as () => unknown)() };
    }
    case z.ZodFirstPartyTypeKind.ZodEffects:
      return zodToJsonSchema(def.schema as z.ZodTypeAny);
    default:
      return {};
  }
}

const ERROR_RESPONSE = {
  description: "Error",
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: { error: { type: "object", properties: { message: { type: "string" } } } },
      },
    },
  },
};

const AUTH_RESPONSES = {
  "401": { ...ERROR_RESPONSE, description: "Not authenticated" },
  "403": { ...ERROR_RESPONSE, description: "Authenticated but not permitted" },
  "400": { ...ERROR_RESPONSE, description: "Validation failed" },
};

const PAGE_PARAMS = [
  {
    name: "limit", in: "query", required: false,
    schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    description: "Page size (1–100).",
  },
  {
    name: "cursor", in: "query", required: false,
    schema: { type: "string" },
    description: "Opaque cursor from a previous response's page.nextCursor.",
  },
];

const IDEMPOTENCY_HEADER = {
  name: "Idempotency-Key", in: "header", required: true,
  schema: { type: "string" },
  description: "Replaying the same key with the same body returns the stored response; a different body returns 409.",
};

function pagedResponse(itemDescription: string) {
  return {
    description: itemDescription,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            data: { type: "array", items: { type: "object" } },
            page: {
              type: "object",
              properties: {
                limit: { type: "integer" },
                hasMore: { type: "boolean" },
                nextCursor: { type: ["string", "null"] },
              },
            },
          },
        },
      },
    },
  };
}

export interface SpecSchemas {
  createCompany: z.ZodTypeAny;
  register: z.ZodTypeAny;
  rfq: z.ZodTypeAny;
  openCase: z.ZodTypeAny;
  transitionItem: z.ZodTypeAny;
  submitOffer: z.ZodTypeAny;
  sendMessage: z.ZodTypeAny;
  requestUpload: z.ZodTypeAny;
}

export function buildOpenApiDocument(schemas: SpecSchemas, baseUrl: string) {
  const body = (schema: z.ZodTypeAny) => ({
    required: true,
    content: { "application/json": { schema: zodToJsonSchema(schema) } },
  });
  const jsonResponse = (description: string, schema: z.ZodTypeAny) => ({
    description,
    content: { "application/json": { schema: zodToJsonSchema(schema) } },
  });

  return {
    openapi: "3.1.0",
    info: {
      title: `${brand.name} API`,
      version: "1.0.0",
      description:
        "Verified cross-border subcontracting. Session-cookie authentication; " +
        "record-creating POSTs require an Idempotency-Key; list endpoints use cursor pagination.",
    },
    servers: [{ url: baseUrl }],
    paths: {
      "/api/healthz": {
        get: {
          summary: "Liveness — process only, no dependencies",
          security: [],
          responses: { "200": { description: "Process alive" } },
        },
      },
      "/api/readyz": {
        get: {
          summary: "Readiness — database reachable and not draining",
          security: [],
          responses: {
            "200": { description: "Ready to serve" },
            "503": { description: "Database unreachable, or shutting down" },
          },
        },
      },
      // Public read surface. Unauthenticated on purpose: a client that
      // must sign in before it can render a browse screen cannot have a
      // browse screen. These are the endpoints an iOS or Android client
      // needs first, and they existed only as web-only server actions.
      "/api/v1/suppliers": {
        get: {
          summary: "Search verified and unverified suppliers",
          security: [],
          parameters: [
            { name: "q", in: "query", schema: { type: "string" }, description: "Free text; trade names match in any supported locale" },
            { name: "country", in: "query", schema: { type: "string", enum: ["LT", "PL", "LV", "EE"] } },
            { name: "language", in: "query", schema: { type: "string" } },
            { name: "verified", in: "query", schema: { type: "string", enum: ["1"] }, description: "Verified suppliers only" },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 30 } },
          ],
          responses: { "200": jsonResponse("Matching suppliers", suppliersResponseSchema) },
        },
      },
      "/api/v1/catalog": {
        get: {
          summary: "Trades and corridors — reference data every client needs",
          security: [],
          responses: { "200": jsonResponse("Trades and corridors", catalogResponseSchema) },
        },
      },
      "/api/v1/auth/register": {
        post: {
          summary: "Self-serve registration (buyer or supplier only)",
          security: [],
          requestBody: body(schemas.register),
          responses: { "201": { description: "Account created" }, ...AUTH_RESPONSES },
        },
      },
      "/api/v1/companies": {
        get: {
          summary: "List companies",
          parameters: PAGE_PARAMS,
          responses: { "200": pagedResponse("A page of companies"), ...AUTH_RESPONSES },
        },
        post: {
          summary: "Create a company",
          parameters: [IDEMPOTENCY_HEADER],
          requestBody: body(schemas.createCompany),
          responses: {
            "201": { description: "Company created" },
            "409": { ...ERROR_RESPONSE, description: "Idempotency key reused with a different body" },
            ...AUTH_RESPONSES,
          },
        },
      },
      "/api/v1/rfqs": {
        post: {
          summary: "Submit a request for work (creates a buyer account if needed)",
          security: [],
          parameters: [IDEMPOTENCY_HEADER],
          requestBody: body(schemas.rfq),
          responses: { "201": { description: "RFQ created" }, ...AUTH_RESPONSES },
        },
      },
      "/api/v1/offers": {
        get: {
          summary: "Offers visible to the caller for one RFQ",
          parameters: [
            { name: "rfqId", in: "query", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            "200": { description: "Offers the caller may see (a supplier sees only their own)" },
            ...AUTH_RESPONSES,
          },
        },
        post: {
          summary: "Submit an offer on a dispatched RFQ (supplier or ops)",
          parameters: [IDEMPOTENCY_HEADER],
          requestBody: body(schemas.submitOffer),
          responses: { "201": { description: "Offer submitted" }, ...AUTH_RESPONSES },
        },
      },
      "/api/v1/offers/{id}/accept": {
        post: {
          summary: "Accept an offer (RFQ owner or ops)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: { "200": { description: "Offer accepted" }, ...AUTH_RESPONSES },
        },
      },
      "/api/v1/offers/{id}/withdraw": {
        post: {
          summary: "Withdraw an offer (offering supplier or ops)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: { "200": { description: "Offer withdrawn" }, ...AUTH_RESPONSES },
        },
      },
      "/api/v1/rfqs/{id}/messages": {
        get: {
          summary: "Threads on an RFQ with their messages, scoped to the caller",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: { "200": { description: "Threads and messages" }, ...AUTH_RESPONSES },
        },
        post: {
          summary: "Post a message into the caller's thread on an RFQ",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
            IDEMPOTENCY_HEADER,
          ],
          requestBody: body(schemas.sendMessage),
          responses: { "201": { description: "Message posted" }, ...AUTH_RESPONSES },
        },
      },
      "/api/v1/documents": {
        post: {
          summary: "Presign an evidence upload (supplier uploads to own company)",
          parameters: [IDEMPOTENCY_HEADER],
          requestBody: body(schemas.requestUpload),
          responses: {
            "201": { description: "Presigned PUT URL and the document id to confirm" },
            ...AUTH_RESPONSES,
          },
        },
      },
      "/api/v1/documents/{id}/confirm": {
        post: {
          summary: "Confirm an upload completed — enqueue the malware scan",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: { "200": { description: "Scan enqueued" }, ...AUTH_RESPONSES },
        },
      },
      "/api/v1/verification/cases": {
        post: {
          summary: "Open a verification case (ops/admin)",
          parameters: [IDEMPOTENCY_HEADER],
          requestBody: body(schemas.openCase),
          responses: { "201": { description: "Case opened" }, ...AUTH_RESPONSES },
        },
      },
      "/api/v1/verification/items/{id}": {
        patch: {
          summary: "Decide a verification item (ops/admin)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          requestBody: body(schemas.transitionItem),
          responses: { "200": { description: "Item updated" }, ...AUTH_RESPONSES },
        },
      },
      "/api/v1/deals/export": {
        get: {
          summary: "Deals as CSV for manual invoicing (ops/admin)",
          responses: {
            "200": { description: "CSV export", content: { "text/csv": { schema: { type: "string" } } } },
            ...AUTH_RESPONSES,
          },
        },
      },
      "/api/v1/me/export": {
        get: {
          summary: "GDPR data export for the signed-in subject",
          parameters: [{
            name: "userId", in: "query", required: false,
            schema: { type: "string", format: "uuid" },
            description: "Ops/admin only: export another subject on their behalf.",
          }],
          responses: { "200": { description: "JSON export" }, ...AUTH_RESPONSES },
        },
      },
      "/api/jobs/expiry": {
        post: {
          summary: "Run the verification expiry sweep (scheduler or admin/ops)",
          security: [{ cronSecret: [] }],
          responses: { "200": { description: "Sweep result" }, "403": ERROR_RESPONSE },
        },
      },
    },
    components: {
      securitySchemes: {
        sessionCookie: { type: "apiKey", in: "cookie", name: "authjs.session-token" },
        cronSecret: { type: "http", scheme: "bearer", description: "CRON_SECRET bearer token" },
      },
    },
    security: [{ sessionCookie: [] }],
  };
}
