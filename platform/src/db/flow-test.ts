/**
 * End-to-end business flow test (run with tsx against a seeded database).
 *
 * Complements src/db/smoke.ts: where smoke proves each milestone's
 * Definition of Done, this walks the complete commercial journey with two
 * competing suppliers, then asserts the guarantees that protect the
 * business — RBAC boundaries, audit completeness, snapshot immutability,
 * expiry warnings and multi-corridor requirement catalogues.
 *
 *   npm run db:seed && npx tsx src/db/flow-test.ts
 */
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { logger } from "@/lib/logger";
import { users } from "@/modules/identity/schema";
import { getCorridorBySlug, listTrades } from "@/modules/catalog/service";
import {
  addWorker,
  createCapacityListing,
  assignOwnership,
  createCompany,
  getCompany,
  requestClaim,
  updateCompanyProfile,
} from "@/modules/companies/service";
import { companies as companiesTable } from "@/modules/companies/schema";
import { searchSuppliers } from "@/modules/search/service";
import {
  buyerIdentityGaps,
  createRfq,
  dispatchRfq,
  findOrCreateBuyer,
  getRfq,
  listOpenRfqsForSupplier,
  qualifyRfq,
  selfDispatch,
} from "@/modules/rfq/service";
import {
  acceptOffer,
  dealsCsv,
  getDealForRfq,
  listOffersForRfq,
  listOffersForRfqAs,
  recordDeal,
  submitOffer,
} from "@/modules/offers/service";
import {
  getOrCreateThread,
  listMessages,
  sendMessage,
} from "@/modules/messaging/service";
import {
  listStaffUsers,
  provisionStaffUser,
  registerUser,
  setUserActive,
} from "@/modules/identity/service";
import {
  consumeMagicLink,
  purgeExpiredTokens,
  requestMagicLink,
} from "@/modules/identity/magic-link";
import {
  exportUserData,
  purgeExpiredUsers,
  requestErasure,
} from "@/modules/identity/gdpr";
import { listCompaniesPage } from "@/modules/companies/service";
import { decodeCursor, encodeCursor } from "@/lib/api";
import { dispatchOutbox } from "@/jobs/start";
import {
  getCaseWithItems,
  getVerifiedFacts,
  getVerifiedFactsForCompany,
  isCompanyVerifiedForDestination,
  openCase,
  resolveCompanyCorridorId,
  runExpirySweep,
  transitionCase,
  transitionItem,
} from "@/modules/verification/service";
import {
  verificationItems,
  opsTasks,
} from "@/modules/verification/schema";
import { auditEvents } from "@/modules/audit/schema";
import { sessions as sessionsTable } from "@/modules/identity/schema";
import {
  createSession,
  resolveSession,
  revokeSession,
} from "@/modules/identity/session";
import {
  authenticateApiKey,
  createApiKey,
  hasScope,
  revokeApiKey,
} from "@/modules/identity/api-keys";
import {
  confirmUploadAs,
  createUpload,
  getDownloadUrl,
  infectedDocumentIds,
  markScanResult,
  requestUpload,
} from "@/modules/documents/service";
import { requirementDefinitions } from "@/modules/catalog/schema";
import type { Actor } from "@/modules/identity/rbac";

let passed = 0;
function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(`FLOW FAIL: ${label}`);
  passed += 1;
  logger.info(`ok: ${label}`);
}
async function rejects(fn: () => Promise<unknown>, label: string) {
  try {
    await fn();
  } catch {
    passed += 1;
    logger.info(`ok: ${label}`);
    return;
  }
  throw new Error(`FLOW FAIL: ${label} (call unexpectedly succeeded)`);
}
const stamp = Date.now();
const DAY = 24 * 3600 * 1000;

/** Drive a freshly opened case all the way to verified. */
async function verifyEverything(
  actor: Actor,
  caseId: string,
  validUntil: Date,
) {
  await transitionCase(actor, caseId, "in_review");
  const opened = await getCaseWithItems(caseId);
  for (const item of opened!.items) {
    await transitionItem(actor, item.id, "submitted", {});
    await transitionItem(actor, item.id, "in_review", {});
    await transitionItem(actor, item.id, "approved", { validUntil, decisionNote: "evidence reviewed" });
  }
  await transitionCase(actor, caseId, "verified");
}

async function main() {
  const admin = await db.query.users.findFirst({
    where: eq(users.email, "admin@piotrr.example"),
  });
  if (!admin) throw new Error("Seed the database first (npm run db:seed)");
  const ops: Actor = { userId: admin.id, role: "admin" };
  const corridor = await getCorridorBySlug("lt-se");
  const corridorPl = await getCorridorBySlug("pl-se");
  if (!corridor || !corridorPl) throw new Error("Corridors missing");
  const trades = await listTrades();
  const welding = trades.find((t) => t.slug === "welding")!;

  // ---------------------------------------------------------------- 1
  logger.info("--- 1. Two suppliers onboard and get verified ---");
  const supplierA = await registerUser({
    email: `flow-a-${stamp}@example.com`,
    password: "flow-password-123",
    name: "Supplier A owner",
    role: "supplier",
  });
  const supplierB = await registerUser({
    email: `flow-b-${stamp}@example.com`,
    password: "flow-password-123",
    name: "Supplier B owner",
    role: "supplier",
  });
  const actorA: Actor = { userId: supplierA.id, role: "supplier" };
  const actorB: Actor = { userId: supplierB.id, role: "supplier" };

  const coA = await createCompany(actorA, {
    name: `Flow Alpha Weld UAB ${stamp}`,
    country: "LT",
    city: "Kaunas",
  });
  const coB = await createCompany(actorB, {
    name: `Flow Beta Weld UAB ${stamp}`,
    country: "LT",
    city: "Vilnius",
  });
  const wA = await addWorker(ops, { companyId: coA.id, name: "Aa Aa", tradeRole: "welder" });
  const wB = await addWorker(ops, { companyId: coB.id, name: "Bb Bb", tradeRole: "welder" });

  const caseA = await openCase(ops, {
    companyId: coA.id, corridorId: corridor.id, workerIds: [wA.id],
  });
  const caseB = await openCase(ops, {
    companyId: coB.id, corridorId: corridor.id, workerIds: [wB.id],
  });
  const farFuture = new Date(Date.now() + 365 * DAY);
  await verifyEverything(ops, caseA.id, farFuture);
  await verifyEverything(ops, caseB.id, farFuture);
  assert((await getVerifiedFacts(coA.id, corridor.id)).verified, "supplier A verified");
  assert((await getVerifiedFacts(coB.id, corridor.id)).verified, "supplier B verified");

  // ---------------------------------------------------------------- 2
  logger.info("--- 2. Buyer submits an RFQ (anonymous intake) ---");
  const buyer = await findOrCreateBuyer(`flow-buyer-${stamp}@example.com`, "Flow Buyer AB");
  const rfq = await createRfq(buyer.userId, {
    title: "Rostfri rörsvets — Västerås",
    description: "Sex svetsare för rostfria processrör, EN 1090 EXC2, åtta veckor.",
    siteCity: "Västerås",
    siteCountry: "SE",
    tradeId: welding.id,
    headcountNeeded: 6,
    durationWeeks: 8,
    workingLanguage: "en",
  });
  assert(rfq.status === "new", "RFQ starts in status new");

  const buyerActor: Actor = { userId: buyer.userId, role: "buyer" };
  await rejects(() => qualifyRfq(buyerActor, rfq.id), "buyer cannot qualify their own RFQ (ops-only)");
  await rejects(
    () => dispatchRfq(actorA, rfq.id, [coA.id]),
    "supplier cannot dispatch an RFQ to themselves",
  );

  // ---------------------------------------------------------------- 3
  logger.info("--- 3. Ops qualifies and dispatches to both suppliers ---");
  await qualifyRfq(ops, rfq.id);
  assert((await getRfq(rfq.id))!.status === "qualified", "RFQ qualified by ops");
  await dispatchRfq(ops, rfq.id, [coA.id, coB.id]);
  assert((await getRfq(rfq.id))!.status === "dispatched", "RFQ dispatched");

  // ---------------------------------------------------------------- 4
  logger.info("--- 4. Both suppliers submit competing offers ---");
  const offerA = await submitOffer(actorA, {
    rfqId: rfq.id, rateModel: "fixed", amountMinor: 98_000_00,
    currency: "SEK", earliestStart: new Date(Date.now() + 21 * DAY),
    validUntil: new Date(Date.now() + 30 * DAY), note: "Inkl. WPQR-dokumentation.",
    workerIds: [wA.id],
  });
  const offerB = await submitOffer(actorB, {
    rfqId: rfq.id, rateModel: "hourly", amountMinor: 685_00,
    currency: "SEK", earliestStart: new Date(Date.now() + 14 * DAY),
    validUntil: new Date(Date.now() + 30 * DAY), note: "Timpris per montör.",
    workerIds: [wB.id],
  });
  assert((await getRfq(rfq.id))!.status === "offers_in", "RFQ moved to offers_in");
  assert((await listOffersForRfq(rfq.id)).length === 2, "both offers visible to ops");

  // The `/api/v1/offers` visibility rule (listOffersForRfqAs) is the one new
  // authorization surface these endpoints add, so it is tested where the
  // service is, not only through the route: buyer-owner and ops see the
  // whole comparison, each supplier sees only their own bid, and an
  // unrelated principal is refused rather than shown a competitor's price.
  assert(
    (await listOffersForRfqAs(buyerActor, rfq.id)).length === 2,
    "the RFQ owner sees every offer (comparison view)",
  );
  assert(
    (await listOffersForRfqAs(ops, rfq.id)).length === 2,
    "ops sees every offer",
  );
  const aSees = await listOffersForRfqAs(actorA, rfq.id);
  assert(
    aSees.length === 1 && aSees[0]!.companyId === coA.id,
    "a dispatched supplier sees only their own offer, never a rival's",
  );
  const bSees = await listOffersForRfqAs(actorB, rfq.id);
  assert(
    bSees.length === 1 && bSees[0]!.companyId === coB.id,
    "the other supplier likewise sees only their own",
  );
  await rejects(
    () => listOffersForRfqAs({ userId: buyer.userId, role: "supplier" }, rfq.id),
    "a supplier with no dispatched company on this RFQ is refused, not shown offers",
  );

  const snapA = offerA.verificationSnapshot as { companyVerified: boolean; facts: unknown[] };
  assert(snapA.companyVerified === true, "offer A snapshot recorded supplier as verified");
  assert(Array.isArray(snapA.facts) && snapA.facts.length === 10, "snapshot froze all 10 verified facts");

  await rejects(
    () => submitOffer(actorA, {
      rfqId: rfq.id, rateModel: "fixed", amountMinor: 50_000_00,
      currency: "SEK", earliestStart: new Date(Date.now() + 21 * DAY),
      validUntil: new Date(Date.now() + 30 * DAY), workerIds: [wA.id],
    }),
    "a supplier cannot stack a second open offer on the same RFQ",
  );

  // ---------------------------------------------------------------- 5
  logger.info("--- 5. Buyer accepts one offer; the sibling is rejected ---");
  await rejects(() => acceptOffer(actorB, offerA.id), "a rival supplier cannot accept an offer");
  await acceptOffer(buyerActor, offerA.id);
  const after = await listOffersForRfq(rfq.id);
  assert(after.find((o) => o.id === offerA.id)!.status === "accepted", "chosen offer accepted");
  assert(after.find((o) => o.id === offerB.id)!.status === "rejected", "sibling offer auto-rejected");
  assert((await getRfq(rfq.id))!.status === "accepted", "RFQ closed as accepted");

  // ---------------------------------------------------------------- 6
  logger.info("--- 6. Ops records the deal; the success fee is computed ---");
  await rejects(
    () => recordDeal(buyerActor, {
      offerId: offerA.id, contractValueMinor: 98_000_00,
      currency: "SEK", successFeePct: 8,
    }),
    "buyer cannot record a deal (ops-only)",
  );
  const deal = await recordDeal(ops, {
    offerId: offerA.id, contractValueMinor: 98_000_00,
    currency: "SEK", successFeePct: 8,
  });
  assert((await getDealForRfq(rfq.id))!.id === deal.id, "deal retrievable from the RFQ");
  const csv = await dealsCsv(ops);
  const dealRow = csv.split("\n").find((l) => l.startsWith(deal.id))!;
  assert(!!dealRow, "deal appears in the invoicing CSV export");
  const feeCol = Number(dealRow.split(",")[8]);
  assert(feeCol === (98_000_00 * 8) / 100, `success fee derived as value x pct (got ${feeCol})`);
  assert(csv.split("\n")[0]!.includes("fee_amount_minor"), "CSV carries an invoicing header row");

  // ---------------------------------------------------------------- 7
  logger.info("--- 7. Messaging works in both directions ---");
  const thread = await getOrCreateThread(buyerActor, rfq.id, coA.id);
  await sendMessage(buyerActor, thread.id, "Hej — när kan teamet starta?");
  await sendMessage(actorA, thread.id, "Vi kan vara på plats vecka 33.");
  const msgs = await listMessages(actorA, thread.id);
  assert(msgs.length === 2, "both sides' messages are in the thread");
  await rejects(
    () => sendMessage(actorB, thread.id, "Kan jag läsa detta?"),
    "an unrelated supplier cannot post in someone else's thread",
  );

  // ---------------------------------------------------------------- 8
  logger.info("--- 8. Snapshot stays frozen when verification later lapses ---");
  // Pick a *critical* requirement deterministically: only those expire the
  // whole case, and an unordered select would sometimes hand back a
  // non-critical one and make this stage flaky.
  const [critical] = await db
    .select({ id: verificationItems.id })
    .from(verificationItems)
    .innerJoin(
      requirementDefinitions,
      eq(requirementDefinitions.id, verificationItems.requirementDefinitionId),
    )
    .where(
      and(
        eq(verificationItems.caseId, caseA.id),
        eq(requirementDefinitions.critical, 1),
      ),
    )
    .orderBy(requirementDefinitions.sortOrder)
    .limit(1);
  if (!critical) throw new Error("No critical requirement on case A");
  await db.update(verificationItems)
    .set({ validUntil: new Date(Date.now() - 2 * DAY) })
    .where(eq(verificationItems.id, critical.id));
  const sweep = await runExpirySweep(new Date());
  assert(sweep.expiredItems >= 1, "expiry sweep expired the lapsed document");
  assert(!(await getVerifiedFacts(coA.id, corridor.id)).verified, "public badge switched off after lapse");

  const reloaded = (await listOffersForRfq(rfq.id)).find((o) => o.id === offerA.id)!;
  const snapAfter = reloaded.verificationSnapshot as { companyVerified: boolean; facts: unknown[] };
  assert(snapAfter.companyVerified === true, "frozen snapshot still says verified — history is immutable");
  assert(snapAfter.facts.length === 10, "frozen snapshot still carries all 10 facts");

  // ---------------------------------------------------------------- 9
  logger.info("--- 9. Expiry warning windows create ops tasks ---");
  const before = await db.select({ n: sql<number>`count(*)::int` }).from(opsTasks);
  const itemsB = await db.select().from(verificationItems).where(eq(verificationItems.caseId, caseB.id));
  await db.update(verificationItems)
    .set({ validUntil: new Date(Date.now() + 13 * DAY) })
    .where(eq(verificationItems.id, itemsB[0]!.id));
  const warnSweep = await runExpirySweep(new Date());
  assert(warnSweep.warned >= 1, "expiry sweep warned about a document expiring within 14 days");
  const afterTasks = await db.select({ n: sql<number>`count(*)::int` }).from(opsTasks);
  assert(afterTasks[0]!.n > before[0]!.n, "warning created an ops task");
  assert((await getVerifiedFacts(coB.id, corridor.id)).verified, "a warning does NOT revoke the badge");

  // --------------------------------------------------------------- 10
  logger.info("--- 10. PL→SE corridor carries its own requirement catalogue ---");
  const plReqs = await db.select().from(requirementDefinitions)
    .where(eq(requirementDefinitions.corridorId, corridorPl.id));
  assert(plReqs.length === 10, `PL corridor has 10 requirements (got ${plReqs.length})`);
  const plRegistry = plReqs.find((r) => r.key === "registry_extract")!;
  assert(/KRS|CEIDG/.test(plRegistry.nameEn), "PL registry requirement names KRS/CEIDG, not Registrų centras");
  const plA1 = plReqs.find((r) => r.key === "a1_certificate")!;
  assert(/ZUS/.test(plA1.nameEn), "PL A1 requirement names ZUS, not Sodra");

  const coPl = await createCompany(ops, {
    name: `Flow Polska Sp. z o.o. ${stamp}`, country: "PL", city: "Gdańsk",
  });
  const wPl = await addWorker(ops, { companyId: coPl.id, name: "Piotr P.", tradeRole: "welder" });
  const casePl = await openCase(ops, {
    companyId: coPl.id, corridorId: corridorPl.id, workerIds: [wPl.id],
  });
  const plItems = await getCaseWithItems(casePl.id);
  // 7 company/assignment-scope + 3 worker-scope x 1 worker
  assert(
    plItems!.items.length === 10,
    `PL case materializes 10 items for one worker (got ${plItems!.items.length})`,
  );
  const plItemReqIds = new Set(plItems!.items.map((i) => i.requirementDefinitionId));
  const plReqIds = new Set(plReqs.map((r) => r.id));
  assert(
    [...plItemReqIds].every((id) => plReqIds.has(id)),
    "PL case only draws requirements from the PL corridor catalogue",
  );

  // --------------------------------------------------------------- 11
  logger.info("--- 11. Catalog claim: request -> ops approval -> ownership ---");
  /**
   * Each run claims one seeded PL profile, so after enough runs the pool
   * is empty and this stage fails for a reason that has nothing to do
   * with the code — which is how a suite earns a reputation for being
   * flaky and stops being read. It provisions its own profile when the
   * seeded ones are gone.
   */
  let unclaimed = await db.query.companies.findFirst({
    where: and(eq(companiesTable.claimStatus, "unclaimed"), eq(companiesTable.country, "PL")),
  });
  if (!unclaimed) {
    logger.info("no seeded PL profile left unclaimed — creating one for this run");
    const [created] = await db
      .insert(companiesTable)
      .values({
        name: `Flow Catalog PL ${stamp}`,
        country: "PL",
        city: "Gdańsk",
        claimStatus: "unclaimed",
        sourceUrl: "https://example.test/flow-fixture",
      })
      .returning();
    unclaimed = created;
  }
  assert(!!unclaimed, "an unclaimed PL catalog profile exists");
  const claimant = await registerUser({
    email: `flow-claim-${stamp}@example.com`, password: "flow-password-123",
    name: "Claimant", role: "supplier",
  });
  const claimActor: Actor = { userId: claimant.id, role: "supplier" };
  await requestClaim(claimActor, unclaimed!.id);
  await rejects(
    () => assignOwnership(claimActor, unclaimed!.id, claimant.email),
    "a supplier cannot assign ownership to themselves (ops-only)",
  );
  await assignOwnership(ops, unclaimed!.id, claimant.email);
  const claimed = await getCompany(unclaimed!.id);
  assert(claimed!.claimStatus === "claimed", "ops approval transferred ownership");
  assert(claimed!.ownerUserId === claimant.id, "owner recorded on the company");
  assert(
    !(await getVerifiedFacts(unclaimed!.id, corridorPl.id)).verified,
    "taking over a profile does NOT grant verification",
  );

  // --------------------------------------------------------------- 12
  logger.info("--- 12. Search index follows profile edits ---");
  const marker = `zylophonic${stamp}`;
  await updateCompanyProfile(ops, coB.id, { description: `Specialists in ${marker} welding.` });
  const found = await searchSuppliers({ q: marker });
  assert(found.length === 1 && found[0]!.companyId === coB.id, "edited description is searchable immediately");
  const verifiedFirst = await searchSuppliers({ q: "weld" });
  const firstUnverified = verifiedFirst.findIndex((h) => !h.verified);
  const lastVerified = verifiedFirst.map((h) => h.verified).lastIndexOf(true);
  assert(
    firstUnverified === -1 || lastVerified < firstUnverified,
    "verified suppliers rank ahead of unverified ones",
  );

  // --------------------------------------------------------------- 13
  logger.info("--- 13. Audit trail covers every state change ---");
  await dispatchOutbox();
  const auditFor = async (entityId: string) =>
    db.select().from(auditEvents).where(eq(auditEvents.entityId, entityId));
  assert((await auditFor(coA.id)).length > 0, "company mutations are audited");
  assert((await auditFor(caseA.id)).length > 0, "verification case transitions are audited");
  assert((await auditFor(offerA.id)).length > 0, "offer submission/acceptance is audited");
  assert((await auditFor(deal.id)).length > 0, "deal recording is audited");
  const claimAudit = await auditFor(unclaimed!.id);
  assert(
    claimAudit.some((a) => a.action.includes("claim") || a.action.includes("owner")),
    "claim approval is audited",
  );

  // --------------------------------------------------------------- 14
  logger.info("--- 14. Email magic-link sign-in ---");
  const linkUser = await registerUser({
    email: `flow-link-${stamp}@example.com`, password: "flow-password-123",
    name: "Link User", role: "buyer",
  });
  const issued = await requestMagicLink(linkUser.email, "http://localhost:3000", "sv");
  assert(!!issued.devUrl, "console provider surfaces the link for local sign-in");
  const token = new URL(issued.devUrl!).searchParams.get("token")!;
  assert(
    (await consumeMagicLink(linkUser.email, "wrong-token")) === null,
    "a wrong token is rejected",
  );
  // The failed attempt burns the outstanding link, so issue a fresh one.
  const reissued = await requestMagicLink(linkUser.email, "http://localhost:3000", "sv");
  const freshToken = new URL(reissued.devUrl!).searchParams.get("token")!;
  assert(
    (await consumeMagicLink(linkUser.email, freshToken)) === linkUser.id,
    "a valid link signs the right user in",
  );
  assert(
    (await consumeMagicLink(linkUser.email, freshToken)) === null,
    "the same link cannot be used twice",
  );
  const unknown = await requestMagicLink(`nobody-${stamp}@example.com`, "http://localhost:3000");
  assert(
    unknown.devUrl === undefined,
    "an unknown address yields no link (no account enumeration)",
  );
  await purgeExpiredTokens(new Date(Date.now() + 60 * 60 * 1000));
  assert(
    (await consumeMagicLink(linkUser.email, token)) === null,
    "expired tokens are swept away",
  );

  // --------------------------------------------------------------- 15
  logger.info("--- 15. GDPR export and purge ---");
  const exported = await exportUserData(buyerActor, buyer.userId);
  assert(exported.subject.id === buyer.userId, "export identifies the subject");
  assert(
    (exported.rfqs as unknown[]).length >= 1,
    "export includes the subject's RFQs",
  );
  await rejects(
    () => exportUserData(actorB, buyer.userId),
    "a supplier cannot export another person's data",
  );
  assert(
    (await exportUserData(ops, buyer.userId)).subject.id === buyer.userId,
    "ops can export on a subject's behalf",
  );

  const erasable = await registerUser({
    email: `flow-erase-${stamp}@example.com`, password: "flow-password-123",
    name: "To Be Erased", role: "buyer",
  });
  await requestErasure({ userId: erasable.id, role: "buyer" }, erasable.id);
  const tooSoon = await purgeExpiredUsers(new Date());
  const stillThere = await db.query.users.findFirst({ where: eq(users.id, erasable.id) });
  assert(
    stillThere?.email === erasable.email && tooSoon.purged === 0,
    "erasure honours the grace period before purging",
  );
  const afterGrace = new Date(Date.now() + 31 * DAY);
  const purge = await purgeExpiredUsers(afterGrace);
  assert(purge.purged >= 1, "purge runs once the grace period has passed");
  const purged = await db.query.users.findFirst({ where: eq(users.id, erasable.id) });
  assert(
    purged !== undefined && !purged.email.includes("flow-erase") && purged.name === null,
    "purge anonymises the personal fields but keeps referential integrity",
  );
  const purgeAudit = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.entityId, erasable.id));
  assert(
    purgeAudit.some((a) => a.action === "user.pii_purged"),
    "the purge itself is audited — the trail is never erased",
  );

  // --------------------------------------------------------------- 16
  logger.info("--- 16. Cursor pagination walks the full set exactly once ---");
  const pageSize = 10;
  const seen = new Set<string>();
  let cursor: { createdAt: Date; id: string } | undefined;
  let pages = 0;
  for (;;) {
    const rows = await listCompaniesPage(pageSize, cursor);
    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    for (const row of page) {
      assert(!seen.has(row.id), `no company repeats across pages (${row.name})`);
      seen.add(row.id);
    }
    pages += 1;
    if (!hasMore) break;
    const last = page[page.length - 1]!;
    cursor = decodeCursor(encodeCursor(last));
    if (pages > 50) throw new Error("pagination did not terminate");
  }
  const totalRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(companiesTable)
    .where(sql`${companiesTable.deletedAt} is null`);
  const total = totalRows[0]!.n;
  assert(seen.size === total, `pagination saw every company (${seen.size}/${total} in ${pages} pages)`);

  // --------------------------------------------------------------- 17
  logger.info("--- 17. Ops account provisioning is admin-only ---");
  await rejects(
    () => provisionStaffUser(actorA, {
      email: `flow-staff-${stamp}@example.com`, name: "Sneaky", role: "admin",
    }),
    "a supplier cannot provision a staff account",
  );
  const staff = await provisionStaffUser(ops, {
    email: `flow-ops-${stamp}@example.com`, name: "New Colleague", role: "ops",
  });
  assert(staff.role === "ops", "admin provisions an ops account");
  assert(
    staff.passwordHash === null,
    "the new account starts password-less and signs in by email link",
  );
  assert(
    (await listStaffUsers(ops)).some((u) => u.id === staff.id),
    "the account shows up in the internal-accounts list",
  );
  await rejects(
    () => setUserActive(actorA, staff.id, false),
    "a supplier cannot suspend a staff account",
  );
  await setUserActive(ops, staff.id, false);
  const suspended = await db.query.users.findFirst({ where: eq(users.id, staff.id) });
  assert(suspended?.active === false, "admin can suspend a staff account");
  assert(
    (await requestMagicLink(staff.email, "http://localhost:3000")).devUrl === undefined,
    "a suspended account cannot request a sign-in link",
  );

  // --------------------------------------------------------------- 18
  logger.info("--- 18. A verified non-Lithuanian supplier reads as verified ---");
  const plWorker = await addWorker(ops, { companyId: coPl.id, name: "Ola O.", tradeRole: "welder" });
  void plWorker;
  await verifyEverything(ops, casePl.id, farFuture);
  assert(
    (await getVerifiedFacts(coPl.id, corridorPl.id)).verified,
    "the Polish company is verified on its own corridor",
  );
  // The regression: callers used to assume lt-se, which returns nothing here.
  assert(
    !(await getVerifiedFacts(coPl.id, corridor.id)).verified,
    "looking it up on the Lithuanian corridor finds nothing (the old bug)",
  );
  assert(
    (await resolveCompanyCorridorId(coPl.id, "PL")) === corridorPl.id,
    "corridor resolution follows the company's own case",
  );
  const plPublic = await getVerifiedFactsForCompany(coPl.id, coPl.country);
  assert(
    plPublic.verified && plPublic.facts.length === 10,
    "the public profile helper shows the Polish supplier as verified with all 10 facts",
  );
  const plOfferRfq = await createRfq(buyer.userId, {
    title: "Stålmontage — Malmö",
    description: "Montageteam för stålstomme, sex veckor, EN 1090 EXC2.",
    siteCity: "Malmö", siteCountry: "SE", tradeId: welding.id,
    headcountNeeded: 4, durationWeeks: 6, workingLanguage: "en",
  });
  await qualifyRfq(ops, plOfferRfq.id);
  await dispatchRfq(ops, plOfferRfq.id, [coPl.id]);
  const plOwner = await registerUser({
    email: `flow-plowner-${stamp}@example.com`, password: "flow-password-123",
    name: "PL owner", role: "supplier",
  });
  await assignOwnership(ops, coPl.id, plOwner.email);
  const plOffer = await submitOffer(
    { userId: plOwner.id, role: "supplier" },
    {
      rfqId: plOfferRfq.id, rateModel: "fixed", amountMinor: 42_000_00,
      currency: "SEK", earliestStart: new Date(Date.now() + 14 * DAY),
      validUntil: new Date(Date.now() + 30 * DAY), workerIds: [wPl.id],
    },
  );
  const plSnap = plOffer.verificationSnapshot as { companyVerified: boolean; facts: unknown[] };
  assert(
    plSnap.companyVerified === true,
    "the offer snapshot records the Polish supplier as verified, not as unverified",
  );
  assert(plSnap.facts.length === 10, "the snapshot carries all 10 Polish-corridor facts");

  // --------------------------------------------------------------- 19
  logger.info("--- 19. Verification is destination-specific ---");
  assert(
    await isCompanyVerifiedForDestination(coB.id, "SE"),
    "the Lithuanian supplier is verified for Sweden",
  );
  assert(
    !(await isCompanyVerifiedForDestination(coB.id, "DE")),
    "the same supplier is NOT verified for Germany",
  );
  const germanRfq = await createRfq(buyer.userId, {
    title: "Stahlmontage — Hamburg",
    description: "Montageteam für eine Stahlkonstruktion, acht Wochen vor Ort.",
    siteCity: "Hamburg", siteCountry: "DE", tradeId: welding.id,
    headcountNeeded: 5, durationWeeks: 8, workingLanguage: "en",
  });
  await qualifyRfq(ops, germanRfq.id);
  await rejects(
    () => dispatchRfq(ops, germanRfq.id, [coB.id]),
    "dispatch refuses a Sweden-verified supplier for a German site",
  );
  const swedishRfq = await createRfq(buyer.userId, {
    title: "Svetsning — Göteborg",
    description: "Svetsteam för rostfria rör, fyra veckor på plats i Göteborg.",
    siteCity: "Göteborg", siteCountry: "SE", tradeId: welding.id,
    headcountNeeded: 3, durationWeeks: 4, workingLanguage: "en",
  });
  await qualifyRfq(ops, swedishRfq.id);
  await dispatchRfq(ops, swedishRfq.id, [coB.id]);
  assert(
    (await getRfq(swedishRfq.id))!.status === "dispatched",
    "the same supplier dispatches fine to a Swedish site",
  );

  // --------------------------------------------------------------- 20
  logger.info("--- 20. Suppliers can answer qualified requests themselves ---");
  const openForA = await listOpenRfqsForSupplier(actorB, coB.id);
  assert(
    openForA.some((r) => r.id === swedishRfq.id),
    "a verified supplier sees the qualified Swedish request",
  );
  assert(
    !openForA.some((r) => r.id === germanRfq.id),
    "the German request stays hidden — not verified for that destination",
  );
  const selfRfq = await createRfq(buyer.userId, {
    title: "Plåtarbete — Uppsala",
    description: "Plåtteam för fasadarbete, fem veckor på plats i Uppsala.",
    siteCity: "Uppsala", siteCountry: "SE", tradeId: welding.id,
    headcountNeeded: 2, durationWeeks: 5, workingLanguage: "en",
  });
  await qualifyRfq(ops, selfRfq.id);
  await selfDispatch(actorB, selfRfq.id, coB.id);
  assert(
    (await getRfq(selfRfq.id))!.status === "dispatched",
    "a supplier opting in moves the request to dispatched without ops",
  );
  const selfOffer = await submitOffer(actorB, {
    rfqId: selfRfq.id, rateModel: "fixed", amountMinor: 30_000_00,
    currency: "SEK", earliestStart: new Date(Date.now() + 10 * DAY),
    validUntil: new Date(Date.now() + 25 * DAY), workerIds: [wB.id],
  });
  assert(!!selfOffer.id, "and can then quote on it like any dispatched supplier");
  await rejects(
    () => selfDispatch(actorB, germanRfq.id, coB.id),
    "opting in is refused when not verified for the destination",
  );

  // --------------------------------------------------------------- 21
  logger.info("--- 21. Buyer identity and indicative pricing ---");
  const gaps = await buyerIdentityGaps(buyer.userId);
  assert(
    gaps.includes("organisation number missing"),
    "an anonymous buyer is flagged as missing an organisation number",
  );
  const identified = await findOrCreateBuyer(
    `flow-identified-${stamp}@example.com`,
    "Identified Buyer",
    { orgNumber: "556677-8899", companyName: "Bygg AB", country: "SE" },
  );
  const identifiedGaps = await buyerIdentityGaps(identified.userId);
  assert(
    !identifiedGaps.includes("organisation number missing") &&
      !identifiedGaps.includes("company name missing"),
    "a buyer who gave company details is no longer flagged for them",
  );

  const priced = await createCapacityListing(ops, {
    companyId: coB.id, tradeId: welding.id, headcount: 4,
    indicativeRateMinMinor: 480_00, indicativeRateMaxMinor: 620_00,
    indicativeRateCurrency: "SEK", indicativeRateUnit: "hour",
    publish: true,
  });
  assert(
    priced.indicativeRateMinMinor === 480_00 &&
      priced.indicativeRateMaxMinor === 620_00 &&
      priced.indicativeRateCurrency === "SEK",
    "capacity listings carry an indicative rate range",
  );

  logger.info("--- 22. Malware scan gates infected evidence ---");
  // Its own company: coA and coB already carry cases on this corridor.
  const coScan = await createCompany(ops, {
    name: `Flow Scan Gate UAB ${stamp}`,
    country: "LT",
    city: "Kaunas",
  });
  const { document: infectedDoc } = await createUpload(ops, {
    companyId: coScan.id,
    fileName: "eicar.pdf",
    contentType: "application/pdf",
    documentType: "insurance",
    contentLength: 1024,
  });
  assert(infectedDoc.scanStatus === "pending", "a fresh upload starts out unscanned");

  // The `/api/v1/documents` upload guard (requestUpload / confirmUploadAs):
  // a supplier's company is resolved from their session, never from the
  // request, so a supplier cannot plant evidence on another company even by
  // naming its id — and cannot confirm a document that is not theirs.
  const supplierUpload = await requestUpload(actorA, {
    fileName: "own.pdf",
    contentType: "application/pdf",
    companyId: coScan.id, // a company that is NOT actorA's — must be ignored
    contentLength: 1024,
  });
  assert(
    supplierUpload.document.companyId === coA.id,
    "a supplier upload lands in their own company, not the companyId they sent",
  );
  const opsUpload = await requestUpload(ops, {
    fileName: "ops.pdf",
    contentType: "application/pdf",
    companyId: coScan.id,
    contentLength: 1024,
  });
  assert(
    opsUpload.document.companyId === coScan.id,
    "ops uploads into the company they name",
  );
  await rejects(
    () => confirmUploadAs(actorA, infectedDoc.id),
    "a supplier cannot confirm a document belonging to another company",
  );

  await markScanResult(infectedDoc.id, "infected");
  assert(
    (await infectedDocumentIds([infectedDoc.id])).length === 1,
    "a flagged document is reported as infected to other modules",
  );

  let downloadRefused = false;
  try {
    await getDownloadUrl(ops, infectedDoc.id);
  } catch {
    downloadRefused = true;
  }
  assert(downloadRefused, "an infected document cannot be opened, not even by ops");

  const gateCase = await openCase(ops, {
    companyId: coScan.id,
    corridorId: corridor.id,
    workerIds: [],
  });
  const gateItem = (await getCaseWithItems(gateCase.id))!.items[0]!;
  await transitionCase(ops, gateCase.id, "in_review");
  await transitionItem(ops, gateItem.id, "submitted", {
    documentIds: [infectedDoc.id],
  });
  await transitionItem(ops, gateItem.id, "in_review");

  let approvalRefused = false;
  try {
    await transitionItem(ops, gateItem.id, "approved");
  } catch {
    approvalRefused = true;
  }
  assert(approvalRefused, "infected evidence can never carry an approval");

  await markScanResult(infectedDoc.id, "clean");
  const approved = await transitionItem(ops, gateItem.id, "approved");
  assert(
    approved.status === "approved",
    "the same evidence approves once the scan comes back clean",
  );

  // --------------------------------------------------------------- 23
  logger.info("--- 23. Germany and Denmark are real destinations ---");
  const corridorLtDe = await getCorridorBySlug("lt-de");
  const corridorLtDk = await getCorridorBySlug("lt-dk");
  if (!corridorLtDe || !corridorLtDk) throw new Error("DE/DK corridors missing");

  const deReqs = await db
    .select()
    .from(requirementDefinitions)
    .where(eq(requirementDefinitions.corridorId, corridorLtDe.id));
  const deKeys = deReqs.map((r) => r.key);
  assert(deReqs.length === 10, "the German corridor carries ten requirements");
  assert(
    deKeys.includes("de_zoll_notification") &&
      deKeys.includes("de_freistellungsbescheinigung") &&
      deKeys.includes("de_soka_bau"),
    "the German catalogue carries German duties, not Swedish ones",
  );
  assert(!deKeys.includes("id06"), "ID06 is Swedish and absent from the German catalogue");
  assert(
    deReqs.every((r) => r.nameDe && r.nameDe.length > 0),
    "every German requirement has a German name",
  );

  const dkReqs = await db
    .select()
    .from(requirementDefinitions)
    .where(eq(requirementDefinitions.corridorId, corridorLtDk.id));
  const dkKeys = dkReqs.map((r) => r.key);
  assert(
    dkKeys.includes("dk_rut_notification") && dkKeys.includes("dk_afu_contribution"),
    "the Danish catalogue carries Danish duties",
  );
  assert(
    !dkKeys.includes("id06"),
    "Denmark has no ID06 equivalent, and the catalogue does not invent one",
  );
  assert(
    dkReqs.every((r) => r.nameDa && r.nameDa.length > 0),
    "every Danish requirement has a Danish name",
  );

  // A supplier verified on the German corridor can actually be dispatched
  // to a German site — the mirror image of stage 19's refusal.
  const coDe = await createCompany(ops, {
    name: `Flow Germany Ready UAB ${stamp}`,
    country: "LT",
    city: "Vilnius",
  });
  const wDe = await addWorker(ops, { companyId: coDe.id, name: "De De", tradeRole: "welder" });
  const caseDe = await openCase(ops, {
    companyId: coDe.id,
    corridorId: corridorLtDe.id,
    workerIds: [wDe.id],
  });
  await verifyEverything(ops, caseDe.id, farFuture);
  assert(
    await isCompanyVerifiedForDestination(coDe.id, "DE"),
    "a supplier verified on LT→DE is verified for Germany",
  );
  assert(
    !(await isCompanyVerifiedForDestination(coDe.id, "SE")),
    "and is NOT thereby verified for Sweden",
  );

  const deRfq = await createRfq(buyer.userId, {
    title: "Rohrleitungsmontage — München",
    description: "Montageteam für Prozessrohrleitungen, sechs Wochen vor Ort.",
    siteCity: "München", siteCountry: "DE", tradeId: welding.id,
    headcountNeeded: 4, durationWeeks: 6, workingLanguage: "de",
  });
  await qualifyRfq(ops, deRfq.id);
  await dispatchRfq(ops, deRfq.id, [coDe.id]);
  assert(
    (await getRfq(deRfq.id))!.status === "dispatched",
    "the German-verified supplier is dispatched to the German site",
  );

  // --------------------------------------------------------------- 24
  logger.info("--- 24. Own auth: sessions and machine keys ---");
  const authUser = await registerUser({
    email: `flow-auth-${stamp}@example.com`,
    password: "flow-password-123",
    name: "Auth Subject",
    role: "supplier",
  });

  const liveSession = await createSession(authUser.id, { userAgent: "flow-test" });
  assert(liveSession.token.length >= 40, "session tokens are long and random");
  const resolved = await resolveSession(liveSession.token);
  assert(resolved?.userId === authUser.id, "a fresh token resolves to its user");

  const [stored] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.userId, authUser.id));
  assert(
    !!stored && stored.tokenHash !== liveSession.token,
    "the raw token is never stored — only its digest",
  );

  assert(
    (await resolveSession("not-a-real-token")) === null,
    "an unknown token resolves to nobody",
  );

  // Suspension must invalidate live sessions immediately, not at expiry.
  await setUserActive(ops, authUser.id, false);
  assert(
    (await resolveSession(liveSession.token)) === null,
    "suspending an account kills its live sessions at once",
  );
  await setUserActive(ops, authUser.id, true);
  assert(
    (await resolveSession(liveSession.token)) === null,
    "and restoring the account does NOT resurrect the old session",
  );

  const secondSession = await createSession(authUser.id);
  await revokeSession(secondSession.token);
  assert(
    (await resolveSession(secondSession.token)) === null,
    "a revoked session stops working",
  );

  // Machine credentials
  const { plaintext, key } = await createApiKey(ops, {
    name: `flow-key-${stamp}`,
    userId: authUser.id,
    scopes: ["companies:read"],
  });
  assert(plaintext.startsWith("bb_"), "keys carry a greppable prefix");
  assert(
    !plaintext.includes(key.secretHash) && key.secretHash.length === 64,
    "only the digest of the key secret is stored",
  );

  const principal = await authenticateApiKey(plaintext);
  assert(principal?.userId === authUser.id, "a valid key authenticates");
  assert(
    hasScope(principal!, "companies:read") && !hasScope(principal!, "deals:read"),
    "a key grants only the scopes it was issued",
  );
  assert(
    (await authenticateApiKey(`bb_${key.prefix}_wrong-secret`)) === null,
    "the right prefix with the wrong secret is rejected",
  );
  assert(
    (await authenticateApiKey("garbage")) === null,
    "a malformed key is rejected rather than throwing",
  );

  await revokeApiKey(ops, key.id);
  assert(
    (await authenticateApiKey(plaintext)) === null,
    "a revoked key stops working",
  );

  await rejects(
    () =>
      createApiKey(
        { userId: authUser.id, role: "supplier" },
        { name: "nope", userId: authUser.id, scopes: [] },
      ),
    "only an admin can mint machine credentials",
  );

  // Regression: the secret is base64url, so roughly half of all real keys
  // contain "_". Mint a batch and require every one of them to work —
  // a single sample used to pass or fail by luck.
  let withUnderscore = 0;
  for (let i = 0; i < 8; i++) {
    const batch = await createApiKey(ops, {
      name: `flow-batch-${stamp}-${i}`,
      userId: authUser.id,
      scopes: ["rfqs:read"],
    });
    if (batch.plaintext.slice(3 + 13).includes("_")) withUnderscore += 1;
    if (!(await authenticateApiKey(batch.plaintext))) {
      throw new Error(`FLOW FAIL: minted key ${i} did not authenticate`);
    }
  }
  assert(true, `all 8 minted keys authenticate (${withUnderscore} contained "_")`);

  // --------------------------------------------------------------- 25
  logger.info("--- 25. Badges name the destination, not always Sweden ---");
  // The search card must state which countries the badge actually covers.
  const deHit = (await searchSuppliers({ q: "Flow Germany Ready" })).find(
    (h) => h.companyId === coDe.id,
  );
  assert(!!deHit && deHit.verified, "the German-verified supplier is found and verified");
  assert(
    deHit!.verifiedDestinations.includes("DE") &&
      !deHit!.verifiedDestinations.includes("SE"),
    "the search card names DE — and does NOT claim Sweden",
  );

  const seHit = (await searchSuppliers({ q: "Flow Beta Weld" })).find(
    (h) => h.companyId === coB.id,
  );
  assert(
    !!seHit && seHit.verifiedDestinations.includes("SE"),
    "a Sweden-verified supplier names SE",
  );

  // A live session cap keeps the table from growing without bound.
  const capUser = await registerUser({
    email: `flow-cap-${stamp}@example.com`,
    password: "flow-password-123",
    name: "Cap Subject",
    role: "buyer",
  });
  const minted: string[] = [];
  for (let i = 0; i < 23; i++) {
    minted.push((await createSession(capUser.id)).token);
  }
  const stillLive = await Promise.all(minted.map((t) => resolveSession(t)));
  const liveCount = stillLive.filter(Boolean).length;
  assert(liveCount === 20, `only the newest 20 sessions stay live (got ${liveCount})`);
  assert(
    (await resolveSession(minted[0]!)) === null,
    "the oldest session was retired first",
  );
  assert(
    (await resolveSession(minted[22]!)) !== null,
    "the newest session survives",
  );

  logger.info(`Flow test passed ✔ — ${passed} assertions across 25 stages`);
  await pool.end();
}

main().catch(async (error) => {
  logger.error(error, "flow test failed");
  await pool.end().catch(() => undefined);
  process.exit(1);
});
