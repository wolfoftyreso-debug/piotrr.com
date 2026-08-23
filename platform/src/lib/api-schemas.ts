import { z } from "zod";

/**
 * Request schemas for /api/v1, in one place so the routes validate with the
 * same objects the OpenAPI document is generated from (Section 4.5).
 */

export const createCompanySchema = z.object({
  name: z.string().min(2),
  country: z.string().length(2),
  registrationNumber: z.string().optional(),
  vatNumber: z.string().optional(),
  city: z.string().optional(),
  description: z.string().optional(),
  yearFounded: z.number().int().min(1800).max(2100).optional(),
  headcount: z.number().int().min(1).optional(),
  languages: z.array(z.string()).optional(),
});

/** Post a message into an RFQ↔supplier thread (Section 5/M3). */
export const sendMessageSchema = z.object({
  companyId: z.string().uuid(),
  body: z.string().min(1).max(4000),
});

/**
 * Request a presigned PUT for an evidence upload (M2 supplier portal, as an
 * API). `companyId` is honoured only for ops/admin; a supplier always
 * uploads into their own company regardless of what they send.
 */
export const uploadRequestSchema = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.string().min(3).max(100),
  documentType: z.string().max(100).optional(),
  companyId: z.string().uuid().optional(),
  // The declared size caps the presigned PUT (see documents/service). The
  // service enforces the byte ceiling; here we only require a positive int.
  contentLength: z.coerce.number().int().positive(),
});

export const openCaseSchema = z.object({
  companyId: z.string().uuid(),
  corridorId: z.string().uuid(),
  workerIds: z.array(z.string().uuid()).optional(),
});

export const transitionItemSchema = z.object({
  status: z.enum([
    "missing",
    "submitted",
    "in_review",
    "approved",
    "rejected",
    "expired",
  ]),
  decisionNote: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  validFrom: z.coerce.date().nullable().optional(),
  validUntil: z.coerce.date().nullable().optional(),
});

// ---------------------------------------------------------------------
// Response contracts for the public, unauthenticated GET endpoints.
//
// These are not documentation: the route handlers parse their own output
// through them (`.strict()`, so an accidentally leaked column is a thrown
// error, not a silent contract change), the OpenAPI document generates
// its response schemas from them, and `npm run test:contract` validates
// the LIVE HTTP responses against them. One definition, three uses —
// the doc and the wire cannot disagree.
// ---------------------------------------------------------------------

/** A trade as the API publishes it — identity plus the eight names.
 *  Deliberately no created_at: a client rendering a picker has no use
 *  for row bookkeeping, and dates are where wire formats drift. */
export const tradeResponseSchema = z
  .object({
    id: z.string().uuid(),
    slug: z.string().min(1),
    nameEn: z.string().min(1),
    nameSv: z.string().min(1),
    nameLt: z.string().min(1),
    nameLv: z.string().nullable(),
    nameEt: z.string().nullable(),
    namePl: z.string().nullable(),
    nameDe: z.string().nullable(),
    nameDa: z.string().nullable(),
  })
  .strict();

export const corridorResponseSchema = z
  .object({
    id: z.string().uuid(),
    slug: z.string().min(1),
    fromCountry: z.string().length(2),
    toCountry: z.string().length(2),
    serviceType: z.string().min(1),
  })
  .strict();

export const catalogResponseSchema = z
  .object({
    data: z
      .object({
        trades: z.array(tradeResponseSchema),
        corridors: z.array(corridorResponseSchema),
      })
      .strict(),
  })
  .strict();

export const supplierHitResponseSchema = z
  .object({
    companyId: z.string().uuid(),
    name: z.string().min(1),
    slug: z.string().nullable(),
    country: z.string().length(2),
    city: z.string().nullable(),
    description: z.string().nullable(),
    languages: z.array(z.string()),
    yearFounded: z.number().int().nullable(),
    headcount: z.number().int().nullable(),
    verified: z.boolean(),
    verifiedDestinations: z.array(z.string().length(2)),
    unclaimed: z.boolean(),
    category: z.string().nullable(),
    rank: z.number(),
  })
  .strict();

export const suppliersResponseSchema = z
  .object({
    data: z.array(supplierHitResponseSchema),
    count: z.number().int(),
  })
  .strict();
