import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { ForbiddenError, requireAnyRole, type Actor } from "@/modules/identity/rbac";
import { writeAudit } from "@/modules/audit/service";
import { documents } from "./schema";
import { malwareScanner, type ScanResult, type ScanVerdict } from "./scanner";

export type DocumentRow = typeof documents.$inferSelect;

/** Presigned URLs expire ≤ 15 min (Section 4.7) */
const PRESIGN_TTL_SECONDS = 15 * 60;

/**
 * A presigned PUT is otherwise unbounded — the signer commits to bucket,
 * key and content-type but not size, so a single account could stream an
 * arbitrarily large object into the shared bucket. Callers must declare the
 * size; it is capped here and signed as the PUT's Content-Length, which the
 * store enforces against the actual body.
 */
function assertUploadSize(contentLength: number): void {
  if (!Number.isInteger(contentLength) || contentLength <= 0) {
    throw new Error("A positive contentLength is required to size the upload");
  }
  if (contentLength > env.S3_MAX_UPLOAD_BYTES) {
    throw new Error(
      `File is too large: ${contentLength} bytes exceeds the ` +
        `${env.S3_MAX_UPLOAD_BYTES}-byte upload limit`,
    );
  }
}

/**
 * Raised when a download is refused because the malware scan has not
 * cleared the file. Distinct from ForbiddenError: the caller is entitled
 * to the document, the file just is not safe to serve yet — so the UI can
 * say "scanning, try shortly" rather than "access denied".
 */
export class ScanNotClearedError extends Error {
  constructor(readonly scanStatus: "pending" | "infected" | "error") {
    super(
      scanStatus === "infected"
        ? "Document failed the malware scan and cannot be opened"
        : scanStatus === "error"
          ? "Document could not be scanned and cannot be opened"
          : "Document is still being scanned",
    );
    this.name = "ScanNotClearedError";
  }
}

/**
 * Object keys are built server-side from a UUID; the caller's filename is
 * kept only as a readable suffix and must never influence the path.
 * Without this, `../../other-company/x.pdf` writes outside the prefix.
 */
export function safeObjectName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : "file";
}

function s3(): S3Client {
  return new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials:
      env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
}

/** Register a document and return a presigned PUT URL for the private,
 * versioned documents bucket. */
export async function createUpload(
  actor: Actor,
  input: {
    companyId: string;
    workerId?: string;
    fileName: string;
    contentType: string;
    documentType?: string;
    contentLength: number;
  },
): Promise<{ document: DocumentRow; uploadUrl: string }> {
  requireAnyRole(actor, ["ops", "admin", "supplier"]);
  assertUploadSize(input.contentLength);

  const objectKey = `companies/${input.companyId}/${randomUUID()}/${safeObjectName(input.fileName)}`;

  const document = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(documents)
      .values({
        companyId: input.companyId,
        workerId: input.workerId,
        fileName: input.fileName,
        contentType: input.contentType,
        documentType: input.documentType,
        objectKey,
        uploadedBy: actor.userId,
      })
      .returning();
    if (!row) throw new Error("Document insert failed");
    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "document",
      entityId: row.id,
      action: "document.upload_created",
      after: { objectKey, documentType: input.documentType },
    });
    return row;
  });

  const uploadUrl = await getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: env.S3_DOCUMENTS_BUCKET,
      Key: objectKey,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  );

  return { document, uploadUrl };
}

/** Presigned GET for inline preview in the review queue */
export async function getDownloadUrl(
  actor: Actor,
  documentId: string,
): Promise<string> {
  requireAnyRole(actor, ["ops", "admin", "supplier"]);

  const row = await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
  });
  if (!row) throw new Error("Document not found");

  // Knowing an id is not authorisation. Ops review every company's
  // evidence by definition; a supplier may only open their own, or one
  // supplier could read another's A1 certificates and insurance papers.
  if (actor.role === "supplier") {
    const { getCompanyByOwner } = await import("@/modules/companies/service");
    const own = await getCompanyByOwner(actor.userId);
    if (!own || own.id !== row.companyId) {
      // Same message as a missing document: do not confirm the id exists.
      throw new ForbiddenError("Document not found");
    }
  }
  // Default-deny on the scan verdict: only a file the scanner has cleared
  // is handed out, and that holds for ops too — ops open more untrusted
  // attachments than anyone. `infected` is the obvious case, but `pending`
  // and `error` matter as much: an unscanned file and a file the scanner
  // could not read are both files nobody has vouched for. Failing closed
  // means a broken or switched-off scanner shows up as documents that
  // will not open, instead of quietly serving whatever was uploaded.
  if (row.scanStatus !== "clean") {
    throw new ScanNotClearedError(row.scanStatus);
  }

  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: env.S3_DOCUMENTS_BUCKET,
      Key: row.objectKey,
    }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  );
}

/**
 * Generic presign helpers for other modules' media (e.g. portfolio images).
 * Same bucket, same ≤15 min expiry; callers own their metadata rows.
 */
export async function presignPut(
  keyPrefix: string,
  fileName: string,
  contentType: string,
  contentLength: number,
): Promise<{ objectKey: string; uploadUrl: string }> {
  assertUploadSize(contentLength);
  const objectKey = `${keyPrefix}/${randomUUID()}/${safeObjectName(fileName)}`;
  const uploadUrl = await getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: env.S3_DOCUMENTS_BUCKET,
      Key: objectKey,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  );
  return { objectKey, uploadUrl };
}

/**
 * Presign a read for an object key the SERVER produced (portfolio images
 * on the public profile). It takes no actor on purpose — never hand it a
 * key that came from a request body.
 */
export async function presignGet(objectKey: string): Promise<string> {
  if (objectKey.includes("..") || objectKey.startsWith("/")) {
    throw new Error("Refusing to sign a traversing object key");
  }
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: env.S3_DOCUMENTS_BUCKET, Key: objectKey }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  );
}

export async function markScanResult(
  documentId: string,
  status: "clean" | "infected" | "error",
): Promise<void> {
  await db
    .update(documents)
    .set({ scanStatus: status })
    .where(eq(documents.id, documentId));
}

/**
 * The client has finished its presigned PUT. Queue the malware scan
 * (Section 4.7) — callers that skip this are caught by the sweep below.
 */
export async function confirmUpload(documentId: string): Promise<void> {
  const { enqueueScan } = await import("@/jobs/scan-queue");
  await enqueueScan(documentId);
}

/**
 * Presign an evidence upload for the outward API, with the target company
 * resolved server-side from the actor rather than trusted from the request.
 * A supplier can only ever upload into their *own* company — a companyId in
 * the body is ignored — so a stolen or curious key cannot plant evidence on
 * a competitor. Ops/admin act on a company they name explicitly.
 */
export async function requestUpload(
  actor: Actor,
  input: {
    fileName: string;
    contentType: string;
    documentType?: string;
    companyId?: string;
    contentLength: number;
  },
): Promise<{ document: DocumentRow; uploadUrl: string }> {
  requireAnyRole(actor, ["ops", "admin", "supplier"]);

  let companyId: string;
  if (actor.role === "supplier") {
    const { getCompanyByOwner } = await import("@/modules/companies/service");
    const company = await getCompanyByOwner(actor.userId);
    if (!company) throw new Error("No company for this account");
    companyId = company.id; // body companyId is deliberately not consulted
  } else {
    if (!input.companyId) {
      throw new Error("companyId is required for an ops/admin upload");
    }
    companyId = input.companyId;
  }

  return createUpload(actor, {
    companyId,
    fileName: input.fileName,
    contentType: input.contentType,
    documentType: input.documentType,
    contentLength: input.contentLength,
  });
}

/**
 * Confirm an upload (enqueue the malware scan) with an ownership check a
 * bare {@link confirmUpload} does not do: a supplier may confirm only a
 * document belonging to their own company, so one supplier cannot drive the
 * scan pipeline for another's evidence by id. Ops/admin may confirm any.
 */
export async function confirmUploadAs(
  actor: Actor,
  documentId: string,
): Promise<void> {
  requireAnyRole(actor, ["ops", "admin", "supplier"]);
  if (actor.role === "supplier") {
    const { getCompanyByOwner } = await import("@/modules/companies/service");
    const company = await getCompanyByOwner(actor.userId);
    if (
      !company ||
      (await documentsOwnedBy([documentId], company.id)).length === 0
    ) {
      throw new ForbiddenError("This document does not belong to your company");
    }
  }
  await confirmUpload(documentId);
}

/**
 * Stream the stored object past the scanner and record the verdict.
 * Runs in the job worker, never in a request.
 */
export async function scanDocument(documentId: string): Promise<ScanVerdict> {
  const row = await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
  });
  if (!row) throw new Error("Document not found");

  let result: ScanResult;
  try {
    const object = await s3().send(
      new GetObjectCommand({ Bucket: env.S3_DOCUMENTS_BUCKET, Key: row.objectKey }),
    );
    const body = object.Body as AsyncIterable<Uint8Array> | undefined;
    if (!body) throw new Error("Object has no body");
    result = await malwareScanner().scan(body);
  } catch (error) {
    result = {
      verdict: "error",
      detail: error instanceof Error ? error.message : "object unreadable",
    };
  }

  await markScanResult(documentId, result.verdict);
  if (result.verdict !== "clean") {
    logger.warn(
      { documentId, verdict: result.verdict, detail: result.detail },
      "malware scan did not pass",
    );
  }
  return result.verdict;
}

/**
 * Uploads whose scan never ran: the presigned PUT has expired, so anything
 * still `pending` after the TTL either finished uploading without a confirm
 * call, or was abandoned. Re-queue the first kind; the sweep gives up on the
 * second after a day.
 */
export async function pendingScans(now: Date): Promise<{
  rescan: string[];
  abandoned: string[];
}> {
  const settled = new Date(now.getTime() - PRESIGN_TTL_SECONDS * 1000);
  const giveUp = new Date(now.getTime() - 24 * 3600 * 1000);

  const rows = await db
    .select({ id: documents.id, createdAt: documents.createdAt })
    .from(documents)
    .where(
      and(eq(documents.scanStatus, "pending"), lt(documents.createdAt, settled)),
    )
    .limit(500);

  return {
    rescan: rows.filter((r) => r.createdAt >= giveUp).map((r) => r.id),
    abandoned: rows.filter((r) => r.createdAt < giveUp).map((r) => r.id),
  };
}

/**
 * Which of these documents failed the scan. Exported so other modules can
 * refuse to act on infected evidence without reaching into this table.
 */
export async function infectedDocumentIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(inArray(documents.id, ids), eq(documents.scanStatus, "infected")));
  return rows.map((r) => r.id);
}

/**
 * Which of these document ids belong to the given company. Exported so
 * other modules can verify ownership of attached evidence without
 * reaching into this module's table.
 */
export async function documentsOwnedBy(
  ids: string[],
  companyId: string,
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(inArray(documents.id, ids), eq(documents.companyId, companyId)));
  return rows.map((r) => r.id);
}
