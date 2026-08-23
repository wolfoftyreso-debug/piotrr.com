import type PgBoss from "pg-boss";
import { logger } from "@/lib/logger";

export const SCAN_JOB = "document-scan";
export const SCAN_SWEEP_JOB = "document-scan-sweep";

let boss: PgBoss | undefined;

/** Called by startJobs once the queue is up. */
export function registerScanQueue(instance: PgBoss): void {
  boss = instance;
}

/**
 * Queue a malware scan for an uploaded document.
 *
 * Requests may run in a process without the job runner (ENABLE_JOBS unset,
 * tests, one-off scripts). Dropping the enqueue there is safe: the sweep
 * picks up anything still `pending` once the presigned PUT has expired.
 */
export async function enqueueScan(documentId: string): Promise<void> {
  if (!boss) {
    logger.debug({ documentId }, "no job runner in this process; scan left to the sweep");
    return;
  }
  await boss.send(SCAN_JOB, { documentId });
}
