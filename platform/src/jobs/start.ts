import PgBoss from "pg-boss";
import { asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { outboxEvents } from "@/modules/audit/schema";
import { runExpirySweep } from "@/modules/verification/service";
import { expireStaleOffers } from "@/modules/offers/service";
import { purgeExpiredUsers } from "@/modules/identity/gdpr";
import { emailProvider } from "@/modules/notifications/email";
import {
  markScanResult,
  pendingScans,
  scanDocument,
} from "@/modules/documents/service";
import { malwareScanner } from "@/modules/documents/scanner";
import { registerScanQueue, SCAN_JOB, SCAN_SWEEP_JOB } from "./scan-queue";
import { counter, observe, trackEventLoopLag } from "@/lib/metrics";

/**
 * Wrap a job handler so every run is counted and timed.
 *
 * §16 asks that a job's whole lifecycle be observable — queued,
 * processing, completed, failed. Before this, a job that threw was a log
 * line and nothing else: no rate, no trend, nothing to alert on. A
 * malware scan that starts failing for every upload should be visible
 * within a scrape interval, not at the next incident.
 *
 * The handler's own behaviour is unchanged: the error is rethrown so
 * pg-boss still retries and dead-letters exactly as before.
 */
const JOB_NAMES = ["expiry", "outbox", "gdpr-purge", "malware-scan", "scan-sweep"] as const;

/**
 * Publish every job counter at zero before anything runs.
 *
 * A Prometheus counter does not exist until it is first incremented, so
 * `jobs_failed_total` was absent on a healthy system — which makes "no
 * failures" and "the runner never started" look identical to both a
 * dashboard and an alert. Seeding the series at 0 removes that ambiguity
 * and lets rate() have a baseline to work from.
 */
function seedJobCounters(): void {
  for (const job of JOB_NAMES) {
    counter("jobs_started_total", "Job runs started", { job }, 0);
    counter("jobs_completed_total", "Job runs that finished cleanly", { job }, 0);
    counter("jobs_failed_total", "Job runs that threw; pg-boss retries these", { job }, 0);
  }
}

function instrumented<T>(
  name: string,
  handler: (jobs: T) => Promise<void>,
): (jobs: T) => Promise<void> {
  return async (jobs: T) => {
    const started = process.hrtime.bigint();
    counter("jobs_started_total", "Job runs started", { job: name });
    try {
      await handler(jobs);
      counter("jobs_completed_total", "Job runs that finished cleanly", { job: name });
    } catch (error) {
      counter("jobs_failed_total", "Job runs that threw; pg-boss retries these", { job: name });
      throw error;
    } finally {
      observe(
        "job_duration_seconds",
        "Wall-clock time per job run",
        Number(process.hrtime.bigint() - started) / 1e9,
        { job: name },
        [0.1, 0.5, 1, 5, 15, 60, 300],
      );
    }
  };
}

const EXPIRY_JOB = "verification-expiry-sweep";
const OUTBOX_JOB = "outbox-dispatch";
const PURGE_JOB = "gdpr-purge";

/**
 * In-process job runner (Section 3: pg-boss inside the app container).
 * - nightly expiry sweep (30/14/3-day warnings, auto-expiry)
 * - outbox dispatcher fanning domain events out to subscribers
 */
export async function startJobs(): Promise<PgBoss> {
  trackEventLoopLag();
  seedJobCounters();
  const boss = new PgBoss(env.DATABASE_URL);
  boss.on("error", (error) => logger.error(error, "pg-boss error"));
  await boss.start();

  await boss.createQueue(EXPIRY_JOB);
  await boss.createQueue(OUTBOX_JOB);
  await boss.createQueue(PURGE_JOB);
  await boss.createQueue(SCAN_JOB);
  await boss.createQueue(SCAN_SWEEP_JOB);
  registerScanQueue(boss);

  // Nightly at 02:00 UTC
  await boss.schedule(EXPIRY_JOB, "0 2 * * *");
  // Outbox dispatch every minute
  await boss.schedule(OUTBOX_JOB, "* * * * *");
  // GDPR purge of soft-deleted accounts, nightly at 03:00 UTC
  await boss.schedule(PURGE_JOB, "0 3 * * *");
  // Catch uploads whose scan was never queued, every 10 minutes
  await boss.schedule(SCAN_SWEEP_JOB, "*/10 * * * *");

  await boss.work(EXPIRY_JOB, instrumented("expiry", async () => {
    const now = new Date();
    const result = await runExpirySweep(now);
    const expiredOffers = await expireStaleOffers(now);
    logger.info({ ...result, expiredOffers }, "expiry sweep finished");
  }));

  await boss.work(OUTBOX_JOB, instrumented("outbox", async () => {
    await dispatchOutbox();
  }));

  await boss.work(PURGE_JOB, instrumented("gdpr-purge", async () => {
    const result = await purgeExpiredUsers(new Date());
    if (result.purged > 0) logger.info(result, "gdpr purge finished");

    // Sessions that can never authenticate again are just noise in the
    // table — expired, or revoked long enough ago to be past triage value.
    const { purgeDeadSessions } = await import("@/modules/identity/session");
    const sessions = await purgeDeadSessions(new Date());
    if (sessions > 0) logger.info({ sessions }, "dead sessions purged");
  }));

  await boss.work<{ documentId: string }>(SCAN_JOB, instrumented("malware-scan", async ([job]) => {
    if (!job) return;
    await scanDocument(job.data.documentId);
  }));

  await boss.work(SCAN_SWEEP_JOB, instrumented("scan-sweep", async () => {
    const { rescan, abandoned } = await pendingScans(new Date());
    for (const documentId of rescan) await boss.send(SCAN_JOB, { documentId });
    // Past the give-up window the object is not coming; leave it unusable
    // rather than silently pending.
    for (const documentId of abandoned) await markScanResult(documentId, "error");
    if (rescan.length || abandoned.length) {
      logger.info(
        { requeued: rescan.length, abandoned: abandoned.length },
        "scan sweep finished",
      );
    }
  }));

  logger.info(
    { scanner: malwareScanner().name },
    "pg-boss started: expiry sweep + outbox dispatcher + gdpr purge + malware scan",
  );
  return boss;
}

/** Fan unprocessed outbox events out to in-process subscribers */
export async function dispatchOutbox(): Promise<number> {
  const pending = await db
    .select()
    .from(outboxEvents)
    .where(isNull(outboxEvents.processedAt))
    .orderBy(asc(outboxEvents.occurredAt))
    .limit(100);

  for (const event of pending) {
    try {
      await handleEvent(event.eventType, event.payload as Record<string, unknown>);
    } catch (error) {
      logger.error({ error, eventId: event.id }, "outbox handler failed");
      continue; // leave unprocessed; retried next run
    }
    await db
      .update(outboxEvents)
      .set({ processedAt: new Date() })
      .where(eq(outboxEvents.id, event.id));
  }
  return pending.length;
}

async function handleEvent(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  switch (eventType) {
    case "verification.item_expiry_warning": {
      // Supplier email + ops visibility (ops task already created in-tx)
      await emailProvider().send({
        to: "ops@piotrr.example",
        subject: `Document expiring in ${payload.daysUntilExpiry} days`,
        text: `Verification item ${payload.itemId} for company ${payload.companyId} expires soon (window: ${payload.window} days).`,
      });
      break;
    }
    case "verification.case_state_changed": {
      logger.info(payload, "case state changed");
      break;
    }
    case "companies.created": {
      // Self-registered suppliers enter the concierge funnel: ops reviews
      // the profile and opens the verification case.
      if (payload.selfServe === true) {
        const { createOpsTask } = await import("@/modules/verification/service");
        await createOpsTask({
          title: "New self-registered supplier — review and open verification case",
          detail: `Company ${payload.companyId}`,
          companyId: String(payload.companyId),
          dueAt: new Date(),
        });
      }
      break;
    }
    case "identity.user_registered": {
      logger.info(payload, "user registered");
      break;
    }
    case "companies.portfolio_submitted": {
      const { createOpsTask } = await import("@/modules/verification/service");
      await createOpsTask({
        title: "Portfolio image awaiting moderation",
        detail: `Item ${payload.itemId}`,
        companyId: String(payload.companyId),
        dueAt: new Date(),
      });
      break;
    }
    case "companies.claim_requested": {
      const { createOpsTask } = await import("@/modules/verification/service");
      await createOpsTask({
        title: "Claim request — verify ownership and assign the profile",
        detail: `${payload.companyName} · claimant user ${payload.claimantUserId}`,
        companyId: String(payload.companyId),
        dueAt: new Date(),
      });
      break;
    }
    case "companies.claim_approved": {
      await notifyCompanyOwner(
        String(payload.companyId),
        "Your Piotrr profile is now yours",
        "Ownership assigned. Sign in to your portal to complete verification and manage your profile: /portal",
      );
      break;
    }
    case "rfq.created": {
      const { createOpsTask } = await import("@/modules/verification/service");
      await createOpsTask({
        title: "New RFQ — qualify and select suppliers",
        detail: `RFQ ${payload.rfqId}`,
        dueAt: new Date(),
      });
      break;
    }
    case "rfq.dispatched_to_company": {
      await notifyCompanyOwner(
        String(payload.companyId),
        "New work request from Piotrr",
        `A buyer request matching your profile was dispatched to you. Review and submit your offer: /portal/rfq/${payload.rfqId}`,
      );
      break;
    }
    case "offers.submitted": {
      await notifyRfqBuyer(
        String(payload.rfqId),
        "New offer on your request",
        `A verified supplier submitted an offer. Compare offers: /portal/rfq/${payload.rfqId}`,
      );
      break;
    }
    case "offers.accepted": {
      await notifyCompanyOwner(
        String(payload.companyId),
        "Your offer was accepted",
        `The buyer accepted your offer on RFQ /portal/rfq/${payload.rfqId}. Piotrr ops will contact you about the work package.`,
      );
      const { createOpsTask } = await import("@/modules/verification/service");
      await createOpsTask({
        title: "Offer accepted — record the deal for invoicing",
        detail: `Offer ${payload.offerId} on RFQ ${payload.rfqId}`,
        companyId: String(payload.companyId),
        dueAt: new Date(),
      });
      break;
    }
    case "messaging.message_sent": {
      // Deep-linked email to the counterpart (Section 5/M3)
      const rfqId = String(payload.rfqId);
      const senderUserId = String(payload.senderUserId);
      const { getRfq } = await import("@/modules/rfq/service");
      const rfq = await getRfq(rfqId);
      if (rfq && rfq.buyerUserId !== senderUserId) {
        await notifyRfqBuyer(
          rfqId,
          "New message on your request",
          `Open the conversation: /portal/rfq/${rfqId}`,
        );
      } else {
        await notifyCompanyOwner(
          String(payload.companyId),
          "New message from the buyer",
          `Open the conversation: /portal/rfq/${rfqId}`,
        );
      }
      break;
    }
    default:
      logger.debug({ eventType }, "outbox event without subscriber");
  }
}

async function notifyCompanyOwner(
  companyId: string,
  subject: string,
  text: string,
): Promise<void> {
  const { getCompany } = await import("@/modules/companies/service");
  const { getUserById } = await import("@/modules/identity/service");
  const company = await getCompany(companyId);
  const owner = company?.ownerUserId
    ? await getUserById(company.ownerUserId)
    : null;
  if (!owner) {
    logger.info({ companyId, subject }, "no owner user to notify");
    return;
  }
  await emailProvider().send({ to: owner.email, subject, text });
}

async function notifyRfqBuyer(
  rfqId: string,
  subject: string,
  text: string,
): Promise<void> {
  const { getRfq } = await import("@/modules/rfq/service");
  const { getUserById } = await import("@/modules/identity/service");
  const rfq = await getRfq(rfqId);
  const buyer = rfq ? await getUserById(rfq.buyerUserId) : null;
  if (!buyer) return;
  await emailProvider().send({ to: buyer.email, subject, text });
}
