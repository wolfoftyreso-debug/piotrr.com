import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { db } from "@/lib/db";
import { idempotencyKeys } from "@/modules/audit/schema";
import { currentActor } from "@/lib/auth";
import { ForbiddenError, type Actor } from "@/modules/identity/rbac";
import {
  authenticateApiKey,
  hasScope,
  type ApiScope,
} from "@/modules/identity/api-keys";

export function apiError(status: number, message: string) {
  return NextResponse.json({ error: { message } }, { status });
}

/** No credentials at all -> 401. Credentials without the right role -> 403. */
export class UnauthenticatedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export class MissingScopeError extends Error {
  constructor(scope: string) {
    super(`API key lacks the ${scope} scope`);
    this.name = "MissingScopeError";
  }
}

/**
 * Authenticate an `/api/v1` request.
 *
 * Two credentials are accepted, in this order:
 *  1. `Authorization: Bearer bb_<prefix>_<secret>` — a machine key, for
 *     integrations (ERP capacity feeds, a buyer's own tooling).
 *  2. The session cookie — a signed-in human using the same endpoints.
 *
 * A key carries the role of the account it belongs to, so the service
 * layer's RBAC still decides what it may do. Scopes narrow that further;
 * they never widen it.
 */
export async function requireApiActor(scope?: ApiScope): Promise<Actor> {
  const header = (await headers()).get("authorization");
  const bearer = header?.match(/^Bearer\s+(\S+)$/i)?.[1];

  if (bearer) {
    const principal = await authenticateApiKey(bearer);
    if (!principal) throw new UnauthenticatedError("Invalid API key");
    if (scope && !hasScope(principal, scope)) throw new MissingScopeError(scope);
    return { userId: principal.userId, role: principal.role };
  }

  // Cookie path. SameSite=Lax already stops a cross-site POST from
  // carrying the session, but a sibling subdomain is same-site, so verify
  // the origin explicitly rather than relying on one control.
  const h = await headers();
  const origin = h.get("origin");
  if (origin) {
    const host = h.get("host");
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (!host || originHost !== host) {
      throw new UnauthenticatedError("Cross-origin request rejected");
    }
  }

  const actor = await currentActor();
  if (!actor) throw new UnauthenticatedError();
  return actor;
}

export function handleApiError(error: unknown) {
  if (error instanceof BodyTooLargeError) return apiError(413, error.message);
  if (error instanceof UnauthenticatedError) return apiError(401, error.message);
  if (error instanceof MissingScopeError) return apiError(403, error.message);
  if (error instanceof ForbiddenError) return apiError(403, error.message);
  if (error instanceof Error) return apiError(400, error.message);
  return apiError(500, "Internal error");
}

/**
 * Cursor pagination (Section 4.5). Opaque cursor = base64 of the last row's
 * `createdAt` ISO timestamp plus its id, which keeps paging stable when rows
 * share a timestamp.
 */
export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, "utf8").toString(
    "base64url",
  );
}

export function decodeCursor(raw: string | null): Cursor | undefined {
  if (!raw) return undefined;
  const [iso, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
  const createdAt = iso ? new Date(iso) : new Date(NaN);
  if (!id || Number.isNaN(createdAt.getTime())) {
    throw new Error("Malformed cursor");
  }
  return { createdAt, id };
}

/** Reads `?limit=` and `?cursor=` from a request URL. */
export function pageParams(request: Request, fallback = 50) {
  const url = new URL(request.url);
  const raw = Number(url.searchParams.get("limit") ?? fallback);
  const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : fallback, 1), 100);
  return { limit, cursor: decodeCursor(url.searchParams.get("cursor")) };
}

/** Wraps a page of rows in the documented envelope. */
export function pageResponse<T extends { createdAt: Date; id: string }>(
  rows: T[],
  limit: number,
) {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return {
    data,
    page: {
      limit,
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    },
  };
}


/**
 * A JSON body, read with a byte budget.
 *
 * `request.json()` buffers whatever arrives: measured against the
 * production build, a 20 MB POST to a public unauthenticated endpoint
 * was parsed in full before validation refused it — memory a stranger
 * controls, on the cheapest request they can send. Every legitimate
 * payload here is text fields (the largest schema caps a description at
 * 8 000 characters; files travel via presigned PUT, never JSON), so the
 * budget is generous at 256 KiB and unreachable by real use.
 *
 * Two checks, both needed: a declared Content-Length over budget is
 * refused before reading anything, and the stream itself is counted so a
 * chunked or lying client is cut off at the same line rather than
 * trusted for what its header claims.
 */
const MAX_JSON_BODY_BYTES = 256 * 1024;

export class BodyTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body exceeds ${Math.floor(maxBytes / 1024)} KiB`);
    this.name = "BodyTooLargeError";
  }
}

export async function readJsonBody(
  request: Request,
  maxBytes: number = MAX_JSON_BODY_BYTES,
): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BodyTooLargeError(maxBytes);
  }

  if (!request.body) return JSON.parse(await request.text());

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown,
): z.output<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new Error(
      `Validation failed: ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

/**
 * Idempotency keys on all record-creating POST endpoints (Section 4.5).
 * Same key + same payload -> replay stored response. Same key + different
 * payload -> 409.
 *
 * The client-supplied `Idempotency-Key` is NEVER the storage key on its
 * own: it shares a single global table across every endpoint and every
 * caller, authenticated or not. Storing under the bare header would let one
 * principal squat a key another principal later uses (409-ing the honest
 * caller) or, on a payload-hash match, read back a response that was never
 * theirs. So the stored key is scoped to (namespace, method, path, header):
 * a principal's key can only ever collide with that same principal's key on
 * that same route. `namespace` is the authenticated principal id, or an
 * `anon:<ip>` bucket for the two unauthenticated intake routes.
 */
export async function withIdempotency(
  request: Request,
  body: unknown,
  handler: () => Promise<{ status: number; body: unknown }>,
  namespace: string,
): Promise<NextResponse> {
  const clientKey = request.headers.get("idempotency-key");
  if (!clientKey) {
    return apiError(400, "Idempotency-Key header is required");
  }

  const path = (() => {
    try {
      return new URL(request.url).pathname;
    } catch {
      return "";
    }
  })();
  // The storage key nobody but this principal-on-this-route can produce.
  const key = createHash("sha256")
    .update(`${namespace} ${request.method} ${path} ${clientKey}`)
    .digest("hex");

  const requestHash = createHash("sha256")
    .update(JSON.stringify(body ?? null))
    .digest("hex");

  const existing = await db.query.idempotencyKeys.findFirst({
    where: eq(idempotencyKeys.key, key),
  });
  if (existing) {
    if (existing.requestHash !== requestHash) {
      return apiError(409, "Idempotency key reused with a different payload");
    }
    return NextResponse.json(existing.responseBody, {
      status: Number(existing.statusCode ?? 200),
    });
  }

  const result = await handler();
  await db
    .insert(idempotencyKeys)
    .values({
      key,
      requestHash,
      responseBody: result.body,
      statusCode: String(result.status),
    })
    .onConflictDoNothing();

  return NextResponse.json(result.body, { status: result.status });
}
