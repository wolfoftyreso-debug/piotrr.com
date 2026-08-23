/**
 * Adversarial security test (run with tsx against a seeded database).
 *
 *   npm run db:seed && npx tsx src/db/security-test.ts
 *
 * Every case here plays an attacker with a *legitimate* account who knows
 * an id they should not be able to use. A pass means the attack was
 * REFUSED — these assertions fail loudly if a guard is ever removed.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { logger } from "@/lib/logger";
import { users } from "@/modules/identity/schema";
import { getCorridorBySlug, getRequirementsForCorridor } from "@/modules/catalog/service";
import {
  addPortfolioItem,
  addWorker,
  assignOwnership,
  createCompany,
  publicCompanyView,
  requestClaim,
  updateCompanyProfile,
} from "@/modules/companies/service";
import { companies } from "@/modules/companies/schema";
import { exportUserData } from "@/modules/identity/gdpr";
import { registerUser, setPassword, setUserActive } from "@/modules/identity/service";
import { signInWithPassword } from "@/lib/auth";
import {
  createSession,
  resolveSession,
} from "@/modules/identity/session";
import {
  authenticateApiKey,
  createApiKey,
  hasScope,
} from "@/modules/identity/api-keys";
import { consumeMagicLink, requestMagicLink } from "@/modules/identity/magic-link";
import {
  createUpload,
  documentsOwnedBy,
  getDownloadUrl,
  markScanResult,
  presignGet,
} from "@/modules/documents/service";
import {
  getCaseWithItems,
  openCase,
  transitionCase,
  transitionItem,
} from "@/modules/verification/service";
import {
  createRfq,
  dispatchRfq,
  findOrCreateBuyer,
  qualifyRfq,
} from "@/modules/rfq/service";
import {
  acceptOffer,
  recordDeal,
  submitOffer,
} from "@/modules/offers/service";
import { offers } from "@/modules/offers/schema";
import {
  openAgreement,
  sign,
  transition,
  updateTerms,
} from "@/modules/agreements/service";
import {
  companyReputation,
  submitReview,
} from "@/modules/reputation/service";
import { getOrCreateThread, listMessages, sendMessage } from "@/modules/messaging/service";
import { searchSuppliers } from "@/modules/search/service";
import type { Actor } from "@/modules/identity/rbac";

const DAY = 24 * 3600 * 1000;
const farFuture = new Date(Date.now() + 365 * DAY);

/** Approve every item on a case and verify it — the concierge happy path. */
async function verifyAll(actor: Actor, caseId: string, validUntil: Date) {
  await transitionCase(actor, caseId, "in_review");
  const items = (await getCaseWithItems(caseId))!.items;
  for (const item of items) {
    await transitionItem(actor, item.id, "submitted", {});
    await transitionItem(actor, item.id, "in_review", {});
    await transitionItem(actor, item.id, "approved", {
      validUntil,
      decisionNote: "evidence reviewed",
    });
  }
  await transitionCase(actor, caseId, "verified");
}

let passed = 0;
const stamp = Date.now();

function ok(label: string) {
  passed += 1;
  logger.info(`BLOCKED ✔ ${label}`);
}

/** The attack must throw. If it succeeds, that is the vulnerability. */
async function denied(fn: () => Promise<unknown>, label: string) {
  try {
    await fn();
  } catch {
    ok(label);
    return;
  }
  throw new Error(`SECURITY FAIL: ${label} — the attack SUCCEEDED`);
}

async function allowed(fn: () => Promise<unknown>, label: string) {
  await fn();
  passed += 1;
  logger.info(`allowed ✔ ${label}`);
}

async function main() {
  const admin = await db.query.users.findFirst({
    where: eq(users.email, "admin@piotrr.example"),
  });
  if (!admin) throw new Error("Seed the database first (npm run db:seed)");
  const ops: Actor = { userId: admin.id, role: "admin" };
  const corridor = await getCorridorBySlug("lt-se");
  if (!corridor) throw new Error("Corridor lt-se missing");

  // --- Two unrelated suppliers. The attacker is "mallory". -------------
  const victimUser = await registerUser({
    email: `sec-victim-${stamp}@example.com`,
    password: "victim-password-123",
    name: "Victim owner",
    role: "supplier",
  });
  const malloryUser = await registerUser({
    email: `sec-mallory-${stamp}@example.com`,
    password: "mallory-password-123",
    name: "Mallory owner",
    role: "supplier",
  });
  const victim: Actor = { userId: victimUser.id, role: "supplier" };
  const mallory: Actor = { userId: malloryUser.id, role: "supplier" };

  const victimCo = await createCompany(victim, {
    name: `Sec Victim UAB ${stamp}`, country: "LT", city: "Vilnius",
  });
  const malloryCo = await createCompany(mallory, {
    name: `Sec Mallory UAB ${stamp}`, country: "LT", city: "Kaunas",
  });

  logger.info("=== 1. IDOR: documents ===");
  const { document: victimDoc } = await createUpload(ops, {
    companyId: victimCo.id,
    fileName: "a1-certificate.pdf",
    contentType: "application/pdf",
    documentType: "a1_certificate",
    contentLength: 1024,
  });

  // Fresh upload: pending scan. Nobody gets it, however entitled.
  await denied(
    () => getDownloadUrl(ops, victimDoc.id),
    "an unscanned document is not served, not even to ops",
  );
  await markScanResult(victimDoc.id, "infected");
  await denied(
    () => getDownloadUrl(ops, victimDoc.id),
    "an infected document is not served either",
  );
  await markScanResult(victimDoc.id, "error");
  await denied(
    () => getDownloadUrl(ops, victimDoc.id),
    "…nor one the scanner could not read",
  );
  await markScanResult(victimDoc.id, "clean");

  await denied(
    () => getDownloadUrl(mallory, victimDoc.id),
    "a supplier cannot download another company's document by id",
  );
  await allowed(
    () => getDownloadUrl(victim, victimDoc.id),
    "the owning supplier still can",
  );
  await allowed(
    () => getDownloadUrl(ops, victimDoc.id),
    "ops still can — that is their job",
  );

  const owned = await documentsOwnedBy([victimDoc.id], malloryCo.id);
  if (owned.length !== 0) throw new Error("SECURITY FAIL: ownership lookup leaked a document");
  ok("ownership lookup does not attribute a document to the wrong company");

  logger.info("=== 1b. Portfolio keys cannot point at someone else's file ===");
  // An approved portfolio image is presigned and served on a PUBLIC
  // profile page. If the key were free-form, registering a rival's
  // evidence key would publish their A1 certificates.
  await denied(
    () =>
      addPortfolioItem(mallory, {
        companyId: malloryCo.id,
        title: "Borrowed evidence",
        objectKey: victimDoc.objectKey,
        contentType: "image/jpeg",
      }),
    "a supplier cannot register another company's object as their portfolio image",
  );
  await denied(
    () =>
      addPortfolioItem(mallory, {
        companyId: malloryCo.id,
        title: "Traversal",
        objectKey: `portfolio/${malloryCo.id}/../../companies/${victimCo.id}/x.jpg`,
        contentType: "image/jpeg",
      }),
    "…nor traverse out of their own prefix",
  );
  await denied(
    () =>
      addPortfolioItem(mallory, {
        companyId: malloryCo.id,
        title: "Not an image",
        objectKey: `portfolio/${malloryCo.id}/${stamp}/page.html`,
        contentType: "text/html",
      }),
    "…nor register a non-image as a portfolio picture",
  );
  await allowed(
    () =>
      addPortfolioItem(mallory, {
        companyId: malloryCo.id,
        title: "Own project photo",
        objectKey: `portfolio/${malloryCo.id}/${stamp}/site.jpg`,
        contentType: "image/jpeg",
      }),
    "…but their own image under their own prefix is fine",
  );

  logger.info("=== 2. Cross-tenant write: verification ===");
  const w = await addWorker(ops, { companyId: victimCo.id, name: "Vv Vv", tradeRole: "welder" });
  const victimCase = await openCase(ops, {
    companyId: victimCo.id, corridorId: corridor.id, workerIds: [w.id],
  });
  await transitionCase(ops, victimCase.id, "in_review");
  const victimItem = (await getCaseWithItems(victimCase.id))!.items[0]!;

  await denied(
    () => transitionItem(mallory, victimItem.id, "submitted", {}),
    "a supplier cannot move another company's verification item",
  );

  const { document: malloryDoc } = await createUpload(ops, {
    companyId: malloryCo.id,
    fileName: "mine.pdf",
    contentType: "application/pdf",
    contentLength: 1024,
  });
  await denied(
    () => transitionItem(mallory, victimItem.id, "submitted", { documentIds: [malloryDoc.id] }),
    "…nor attach their own evidence to it",
  );

  // The victim may act on their own item, but not attach someone else's file.
  const malloryCase = await openCase(ops, {
    companyId: malloryCo.id, corridorId: corridor.id, workerIds: [],
  });
  await transitionCase(ops, malloryCase.id, "in_review");
  const malloryItem = (await getCaseWithItems(malloryCase.id))!.items[0]!;
  await denied(
    () => transitionItem(mallory, malloryItem.id, "submitted", { documentIds: [victimDoc.id] }),
    "a supplier cannot attach another company's document to their own item",
  );
  await allowed(
    () => transitionItem(mallory, malloryItem.id, "submitted", { documentIds: [malloryDoc.id] }),
    "…but may attach their own",
  );

  logger.info("=== 3. Privilege escalation ===");
  await denied(
    () => transitionItem(mallory, malloryItem.id, "approved", {}),
    "a supplier cannot approve their own verification item",
  );
  await denied(
    () => transitionCase(mallory, malloryCase.id, "verified"),
    "a supplier cannot verify their own case",
  );
  await denied(
    () => openCase(mallory, { companyId: malloryCo.id, corridorId: corridor.id }),
    "a supplier cannot open their own verification case",
  );
  await denied(
    () => createApiKey(mallory, { name: "escalate", userId: admin.id, scopes: [] }),
    "a supplier cannot mint an API key acting as the admin",
  );

  logger.info("=== 4. Messaging isolation ===");
  const buyer = await findOrCreateBuyer(`sec-buyer-${stamp}@example.com`, "Sec Buyer AB");
  const trades = await db.query.trades.findMany();
  const rfq = await createRfq(buyer.userId, {
    title: "Sec test RFQ",
    description: "Ett test av åtkomstkontroll i meddelandetrådar.",
    siteCity: "Västerås", siteCountry: "SE",
    tradeId: trades[0]!.id, headcountNeeded: 2, durationWeeks: 2,
  });
  const thread = await getOrCreateThread(ops, rfq.id, victimCo.id);
  await denied(
    () => listMessages(mallory, thread.id),
    "an uninvolved supplier cannot read another pair's thread",
  );
  await denied(
    () => sendMessage(mallory, thread.id, "Kan jag skriva här?"),
    "…nor post into it",
  );

  // Dispatch gate on messaging: knowing a company id (public) and an RFQ id
  // (mailed as a portal deep link) must NOT let an undispatched supplier open
  // a private thread with the buyer. malloryCo was never dispatched to this
  // RFQ, and mallory owns it — so ownership alone is not enough.
  await denied(
    () => getOrCreateThread(mallory, rfq.id, malloryCo.id),
    "an undispatched supplier cannot open a thread on an RFQ they were not sent",
  );
  // And a thread the concierge opened for an undispatched company stays shut
  // to that company's owner until they are actually dispatched. (The positive
  // case — a dispatched supplier CAN message — is covered by the smoke and
  // flow suites, which verify + dispatch a company before messaging.)
  const undispatchedThread = await getOrCreateThread(ops, rfq.id, malloryCo.id);
  await denied(
    () => sendMessage(mallory, undispatchedThread.id, "Släpp in mig i förhandlingen"),
    "…and cannot post into an ops-opened thread while undispatched",
  );
  // But the supplier gate must NOT bleed onto the buyer or ops: the buyer owns
  // the RFQ and still reads every thread on it — including this ops-opened
  // pre-dispatch thread. If the gate blocked them too, a single undispatched
  // thread would throw and take down the buyer's whole message listing (the
  // GET endpoint reads every thread). Dispatch gates the supplier only.
  const secBuyerActor: Actor = { userId: buyer.userId, role: "buyer" };
  await allowed(
    () => listMessages(secBuyerActor, undispatchedThread.id),
    "the RFQ's buyer still reads an ops-opened pre-dispatch thread (dispatch gate is supplier-only)",
  );
  await allowed(
    () => listMessages(ops, undispatchedThread.id),
    "ops still reads the pre-dispatch concierge thread it opened",
  );

  logger.info("=== 5. Path traversal ===");
  const { document: traversal } = await createUpload(ops, {
    companyId: malloryCo.id,
    fileName: "../../../victim/steal.pdf",
    contentType: "application/pdf",
    contentLength: 1024,
  });
  if (traversal.objectKey.includes("..")) {
    throw new Error(`SECURITY FAIL: object key escaped its prefix: ${traversal.objectKey}`);
  }
  if (!traversal.objectKey.startsWith(`companies/${malloryCo.id}/`)) {
    throw new Error(`SECURITY FAIL: object key outside the company prefix: ${traversal.objectKey}`);
  }
  ok("a traversing filename cannot move the object outside its company prefix");
  await denied(
    () => presignGet("../../etc/passwd"),
    "presignGet refuses a traversing object key",
  );

  logger.info("=== 6. Session and credential revocation ===");
  const session = await createSession(malloryUser.id);
  await setUserActive(ops, malloryUser.id, false);
  if (await resolveSession(session.token)) {
    throw new Error("SECURITY FAIL: a suspended account kept a live session");
  }
  ok("suspending an account kills its live sessions immediately");

  await setUserActive(ops, malloryUser.id, true);
  const { plaintext, key } = await createApiKey(ops, {
    name: `sec-key-${stamp}`, userId: malloryUser.id, scopes: ["companies:read"],
  });
  if (!(await authenticateApiKey(plaintext))) {
    throw new Error("SECURITY FAIL: a freshly minted key did not authenticate");
  }
  await setUserActive(ops, malloryUser.id, false);
  if (await authenticateApiKey(plaintext)) {
    throw new Error("SECURITY FAIL: an API key outlived its suspended account");
  }
  ok("an API key stops working when its account is suspended");
  if (await authenticateApiKey(`bb_${key.prefix}_wrong`)) {
    throw new Error("SECURITY FAIL: wrong secret accepted");
  }
  ok("the right key id with the wrong secret is refused");
  await setUserActive(ops, malloryUser.id, true);

  logger.info("=== 7. Injection through search ===");
  for (const payload of [
    "'; DROP TABLE companies; --",
    "' OR 1=1 --",
    "%' UNION SELECT null,null,null --",
    "\\'; SELECT pg_sleep(5); --",
  ]) {
    const hits = await searchSuppliers({ q: payload });
    if (!Array.isArray(hits)) throw new Error("SECURITY FAIL: search returned a non-list");
  }
  const stillThere = await db.query.companies.findFirst({ where: eq(users.id, users.id) });
  if (!stillThere) throw new Error("SECURITY FAIL: companies table is gone");
  ok("injection-shaped search payloads are parameterised, not executed");

  logger.info("=== 8. Verified badge integrity: no approval without evidence ===");
  // The public profile claims "granskade dokument — F-skatt, A1,
  // försäkring och certifikat". A critical item approved on nothing would
  // grant the badge behind that claim. Even ops/admin — the highest role —
  // must not.
  const evSup = await registerUser({
    email: `sec-ev-${stamp}@example.com`, password: "evidence-pw-123",
    name: "Evidence Sup", role: "supplier",
  });
  const evCo = await createCompany({ userId: evSup.id, role: "supplier" } as Actor,
    { name: `Evidence UAB ${stamp}`, country: "LT", city: "Kaunas" });
  const evW = await addWorker(ops, { companyId: evCo.id, name: "E W", tradeRole: "welder" });
  const evCase = await openCase(ops, { companyId: evCo.id, corridorId: corridor!.id, workerIds: [evW.id] });
  await transitionCase(ops, evCase.id, "in_review");
  const evReqs = await getRequirementsForCorridor(corridor!.id);
  const evCritIds = new Set(evReqs.filter((r) => r.critical === 1).map((r) => r.id));
  const evItem = (await getCaseWithItems(evCase.id))!.items
    .find((i) => evCritIds.has(i.requirementDefinitionId))!;
  await transitionItem(ops, evItem.id, "submitted", {});
  await transitionItem(ops, evItem.id, "in_review", {});
  await denied(
    () => transitionItem(ops, evItem.id, "approved", { validUntil: new Date(Date.now() + 3.15e10) }),
    "even admin cannot approve a critical requirement with no document and no note",
  );
  await allowed(
    () => transitionItem(ops, evItem.id, "approved", {
      validUntil: new Date(Date.now() + 3.15e10),
      decisionNote: "F-skatt certificate reviewed on file",
    }),
    "a recorded justification lets the same approval through",
  );

  // ==================================================================
  //  A verified supplier, a dispatched SE RFQ, an offer, a deal — the
  //  ground the commerce-integrity attacks stand on. Built once, reused.
  // ==================================================================
  const snapUser = await registerUser({
    email: `sec-snap-${stamp}@example.com`, password: "snap-password-123",
    name: "Snap owner", role: "supplier",
  });
  const snap: Actor = { userId: snapUser.id, role: "supplier" };
  const snapCo = await createCompany(snap, {
    name: `Sec Snap UAB ${stamp}`, country: "LT", city: "Vilnius",
  });
  const snapW = await addWorker(ops, { companyId: snapCo.id, name: "Sn Ap", tradeRole: "welder" });
  const snapCase = await openCase(ops, {
    companyId: snapCo.id, corridorId: corridor.id, workerIds: [snapW.id],
  });
  await verifyAll(ops, snapCase.id, farFuture); // corridor lt-se ⇒ verified for SE

  const snapBuyer = await findOrCreateBuyer(`sec-snapbuyer-${stamp}@example.com`, "Snap Buyer AB");
  const snapBuyerActor: Actor = { userId: snapBuyer.userId, role: "buyer" };
  const seRfq = await createRfq(snapBuyer.userId, {
    title: `Snap SE RFQ ${stamp}`,
    description: "Svetsning på plats i Västerås — verifierad leverantör krävs.",
    siteAddress: "Testgatan 2, Västerås", siteCity: "Västerås", siteCountry: "SE",
    tradeId: trades[0]!.id, headcountNeeded: 2, durationWeeks: 4, workingLanguage: "en",
  });
  await qualifyRfq(ops, seRfq.id);
  await dispatchRfq(ops, seRfq.id, [snapCo.id]);

  logger.info("=== 9. Offer freezes the verification snapshot at submission ===");
  const snapOffer = await submitOffer(snap, {
    rfqId: seRfq.id, rateModel: "fixed", amountMinor: 480000, currency: "EUR",
    validUntil: farFuture, workerIds: [snapW.id],
  });
  const frozen = snapOffer.verificationSnapshot as { companyVerified?: boolean; frozenAt?: string };
  if (frozen?.companyVerified !== true) {
    throw new Error("SECURITY FAIL: a verified supplier's offer did not freeze companyVerified=true");
  }
  if (!frozen.frozenAt) throw new Error("SECURITY FAIL: the snapshot has no frozenAt timestamp");
  ok("the offer froze the company as verified, with a timestamp, at submission time");

  logger.info("=== 10. Corridor destination isolation: SE-verified ≠ dispatchable to DE ===");
  const deRfq = await createRfq(snapBuyer.userId, {
    title: `DE site ${stamp}`,
    description: "Arbetsplatsen ligger i Hamburg — svensk verifiering gäller inte i Tyskland.",
    siteAddress: "Werkstraße 5, Hamburg", siteCity: "Hamburg", siteCountry: "DE",
    tradeId: trades[0]!.id, headcountNeeded: 2, durationWeeks: 3, workingLanguage: "en",
  });
  await qualifyRfq(ops, deRfq.id);
  await denied(
    () => dispatchRfq(ops, deRfq.id, [snapCo.id]),
    "a Sweden-verified supplier cannot be dispatched to a German site",
  );

  logger.info("=== 11. Money integrity: no zero, negative, or foreign-currency offers ===");
  const seRfq2 = await createRfq(snapBuyer.userId, {
    title: `Snap SE RFQ B ${stamp}`,
    description: "Andra förfrågan i Sverige, för test av prisvalidering på offert.",
    siteAddress: "Testgatan 9, Örebro", siteCity: "Örebro", siteCountry: "SE",
    tradeId: trades[0]!.id, headcountNeeded: 1, durationWeeks: 2, workingLanguage: "en",
  });
  await qualifyRfq(ops, seRfq2.id);
  await dispatchRfq(ops, seRfq2.id, [snapCo.id]);
  await denied(
    () => submitOffer(snap, { rfqId: seRfq2.id, rateModel: "fixed", amountMinor: 0, currency: "EUR", workerIds: [snapW.id] }),
    "an offer priced at zero is rejected",
  );
  await denied(
    () => submitOffer(snap, { rfqId: seRfq2.id, rateModel: "fixed", amountMinor: -5000, currency: "EUR", workerIds: [snapW.id] }),
    "a negative-price offer is rejected",
  );
  await denied(
    () => submitOffer(snap, {
      rfqId: seRfq2.id, rateModel: "fixed", amountMinor: 1000,
      // @ts-expect-error — a currency outside the allowed set must be refused
      currency: "USD", workerIds: [snapW.id],
    }),
    "an offer in an unsupported currency is rejected",
  );

  logger.info("=== 12. Reputation: only the buyer, exactly once, average withheld ===");
  await acceptOffer(snapBuyerActor, snapOffer.id);
  const snapDeal = await recordDeal(ops, {
    offerId: snapOffer.id, contractValueMinor: 480000, currency: "EUR", successFeePct: 8,
  });
  const goodScores = { workmanship: 5, schedule: 4, communication: 5, documentation: 4 };
  await denied(
    () => submitReview(mallory, { dealId: snapDeal.id, scores: goodScores }),
    "a stranger cannot review a deal they had no part in",
  );
  await denied(
    () => submitReview(ops, { dealId: snapDeal.id, scores: goodScores }),
    "ops cannot write a review on the buyer's behalf",
  );
  await allowed(
    () => submitReview(snapBuyerActor, { dealId: snapDeal.id, scores: goodScores, comment: "Bra jobb." }),
    "the buyer on the deal can review it once",
  );
  await denied(
    () => submitReview(snapBuyerActor, { dealId: snapDeal.id, scores: goodScores }),
    "the same deal cannot be reviewed twice (deal_id is UNIQUE)",
  );
  const rep = await companyReputation(snapCo.id);
  if (rep.rating.overall !== null) {
    throw new Error("SECURITY FAIL: an average was shown from a single review");
  }
  ok("the average is withheld below three reviews — one 5★ cannot read as a score");

  logger.info("=== 13. Agreement signatures bind one exact document, and ops never sign ===");
  const agreement = await openAgreement(ops, {
    rfqId: seRfq.id, offerId: snapOffer.id, companyId: snapCo.id, buyerUserId: snapBuyer.userId,
  });
  await updateTerms(ops, agreement.id, {
    scope: "Svetsning och montage av bärande stålstomme enligt ritning A-101, MIG/MAG samt rotsvets.",
    siteAddress: "Testgatan 2, Västerås", siteCountry: "SE",
    startDate: new Date(Date.now() + 14 * DAY).toISOString().slice(0, 10),
    rateModel: "fixed", amountMinor: 480000, currency: "EUR",
    suppliedBySupplier: ["svetsutrustning", "personlig skyddsutrustning"],
    paymentTerms: "30 dagar netto efter godkänd delbesiktning.",
  });
  const proposed = await transition(ops, agreement.id, "proposed");
  const goodHash = proposed.documentHash;
  await denied(
    () => sign(ops, agreement.id, { expectedHash: goodHash, signerName: "Ops Person" }),
    "ops can prepare an agreement but can never sign one",
  );
  await denied(
    () => sign(mallory, agreement.id, { expectedHash: goodHash, signerName: "Mallory" }),
    "a party to no side of the deal cannot sign",
  );
  await denied(
    () => sign(snapBuyerActor, agreement.id, { expectedHash: "0".repeat(64), signerName: "Buyer" }),
    "a signature against a stale document hash is refused",
  );
  await allowed(
    () => sign(snapBuyerActor, agreement.id, { expectedHash: goodHash, signerName: "Buyer Rep" }),
    "the buyer signs the exact document shown",
  );
  await allowed(
    () => sign(snap, agreement.id, { expectedHash: goodHash, signerName: "Snap Rep" }),
    "the supplier signs the same document — now fully signed",
  );
  await denied(
    () => updateTerms(ops, agreement.id, { paymentTerms: "Förskott 100 %." }),
    "a fully-signed agreement can no longer be edited, only superseded",
  );

  logger.info("=== 14. The frozen snapshot survives a later downgrade ===");
  await transitionCase(ops, snapCase.id, "suspended");
  const reread = await db.query.offers.findFirst({ where: eq(offers.id, snapOffer.id) });
  const stillFrozen = reread!.verificationSnapshot as { companyVerified?: boolean };
  if (stillFrozen?.companyVerified !== true) {
    throw new Error("SECURITY FAIL: suspending the company rewrote the offer's frozen snapshot");
  }
  ok("suspending the company later does NOT rewrite the buyer's frozen offer snapshot");

  logger.info("=== 15. GDPR export is scoped to its subject ===");
  await denied(
    () => exportUserData(mallory, victimUser.id),
    "a supplier cannot export another person's data through the export endpoint",
  );
  const victimExport = await exportUserData(victim, victimUser.id);
  passed += 1;
  logger.info("allowed ✔ a person can export their own data");
  if (victimExport.subject.id !== victimUser.id) {
    throw new Error("SECURITY FAIL: the export subject is not the requester");
  }
  if (victimExport.subject.email !== victimUser.email) {
    throw new Error("SECURITY FAIL: the export returned a different subject");
  }
  ok("a self-export returns exactly the requester as its subject");
  await allowed(
    () => exportUserData(ops, victimUser.id),
    "ops can export on the subject's behalf (a subject-access request arrives by email)",
  );

  logger.info("=== 16. Unclaimed catalog profiles cannot be seized without ops ===");
  const unclaimed = await db.query.companies.findFirst({
    where: and(eq(companies.claimStatus, "unclaimed"), isNull(companies.ownerUserId)),
  });
  if (!unclaimed) throw new Error("Seed the catalog first (npm run db:seed-catalog)");

  const claimerUser = await registerUser({
    email: `sec-claimer-${stamp}@example.com`, password: "claimer-password-123",
    name: "Claimer owner", role: "supplier",
  });
  const claimer: Actor = { userId: claimerUser.id, role: "supplier" };

  await allowed(
    () => requestClaim(claimer, unclaimed.id),
    "a supplier without a company may request a claim on an unclaimed profile",
  );
  const afterRequest = await db.query.companies.findFirst({ where: eq(companies.id, unclaimed.id) });
  if (afterRequest!.ownerUserId !== null || afterRequest!.claimStatus !== "unclaimed") {
    throw new Error("SECURITY FAIL: requesting a claim transferred ownership without ops review");
  }
  ok("requesting a claim does NOT assign ownership — it stays unclaimed until ops approve");

  await denied(
    () => assignOwnership(claimer, unclaimed.id, claimerUser.email),
    "a supplier cannot approve their own claim — ownership assignment is ops-only",
  );
  await denied(
    () => requestClaim(claimer, victimCo.id),
    "a supplier cannot claim a profile that is already owned",
  );
  await denied(
    () => requestClaim(mallory, unclaimed.id),
    "an account that already owns a company cannot grab a second profile",
  );
  await allowed(
    () => assignOwnership(ops, unclaimed.id, claimerUser.email),
    "ops approves the claim and assigns ownership",
  );
  const afterApprove = await db.query.companies.findFirst({ where: eq(companies.id, unclaimed.id) });
  if (afterApprove!.ownerUserId !== claimerUser.id || afterApprove!.claimStatus !== "claimed") {
    throw new Error("SECURITY FAIL: ops approval did not assign ownership as recorded");
  }
  ok("after ops approval the profile is owned and marked claimed");
  await denied(
    () => requestClaim(mallory, unclaimed.id),
    "a profile that has been claimed is no longer open for claims",
  );

  logger.info("=== 17. Anonymous RFQ intake cannot bind to a non-buyer account ===");
  // findOrCreateBuyer is the unauthenticated intake path. Reusing an
  // existing *buyer* is by design; adopting a staff or supplier account by
  // email — with no mailbox proof — would let anyone plant RFQs in their
  // portal and the ops queue.
  await denied(
    () => findOrCreateBuyer(admin.email, "Impersonated Ops"),
    "an anonymous RFQ cannot be filed against an ops/admin account by email",
  );
  await denied(
    () => findOrCreateBuyer(malloryUser.email, "Impersonated Supplier"),
    "…nor against a supplier account by email",
  );
  await allowed(
    () => findOrCreateBuyer(`sec-shellbuyer-${stamp}@example.com`, "Shell Buyer AB"),
    "…but a genuine buyer email still auto-creates a buyer",
  );
  // A password-less shell (created by a prior anonymous RFQ) stays reusable
  // under requireFresh, so intake is idempotent under retries — a failed
  // createRfq must not strand the submitter behind a hard refusal.
  await allowed(
    () =>
      findOrCreateBuyer(`sec-shellbuyer-${stamp}@example.com`, "Shell Buyer AB", undefined, {
        requireFresh: true,
      }),
    "…and a retry may reuse the password-less shell it just created (idempotent intake)",
  );
  // A REAL, registered buyer (with a password) must not be filed under by an
  // anonymous caller — that would plant in a live portal.
  const regBuyer = await registerUser({
    email: `sec-regbuyer-${stamp}@example.com`, password: "regbuyer-password-123",
    name: "Registered Buyer", role: "buyer",
  });
  await denied(
    () =>
      findOrCreateBuyer(regBuyer.email, "Registered Buyer", undefined, { requireFresh: true }),
    "…but anonymous intake cannot file under a registered (password-holding) buyer",
  );
  // A shell whose owner has since signed in with a magic link (which stamps
  // emailVerifiedAt) is a live portal too, even with no password.
  const vShell = await findOrCreateBuyer(`sec-vshell-${stamp}@example.com`, "Verified Shell AB");
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, vShell.userId));
  await denied(
    () =>
      findOrCreateBuyer(`sec-vshell-${stamp}@example.com`, "Verified Shell AB", undefined, {
        requireFresh: true,
      }),
    "…nor under a shell whose owner has proven the mailbox (emailVerifiedAt set)",
  );

  logger.info("=== 18. The machine company list hides internal CRM fields ===");
  const pub = publicCompanyView(victimCo) as Record<string, unknown>;
  for (const hidden of ["ownerUserId", "vatNumber", "sourceUrl", "sourceName"]) {
    if (hidden in pub) {
      throw new Error(`SECURITY FAIL: public company view leaked ${hidden}`);
    }
  }
  if (pub.name !== victimCo.name || pub.id !== victimCo.id) {
    throw new Error("SECURITY FAIL: public company view dropped a public field");
  }
  ok("the non-ops company projection carries public fields but no internal CRM columns");

  logger.info("=== 19. API-key scopes gate writes, not just reads ===");
  // A key inherits its account's role, so an ops key could once write to any
  // route that only checked a read scope (or none). Write routes now require
  // the matching :write scope — a read-only key cannot satisfy it even on an
  // ops account.
  const { plaintext: roKey } = await createApiKey(ops, {
    name: `sec-ro-${stamp}`, userId: admin.id, scopes: ["verification:read"],
  });
  const roPrincipal = await authenticateApiKey(roKey);
  if (!roPrincipal) throw new Error("SECURITY FAIL: a read-only key did not authenticate");
  if (!hasScope(roPrincipal, "verification:read")) {
    throw new Error("SECURITY FAIL: the read scope it was granted is missing");
  }
  if (hasScope(roPrincipal, "verification:write")) {
    throw new Error("SECURITY FAIL: a read-only key satisfied a write scope");
  }
  ok("a verification:read key does not satisfy verification:write — write routes now require it");

  logger.info("=== 20. A supplier cannot store a script-scheme website ===");
  // company.website is supplier-controlled and rendered as <a href> on the
  // public profile. A javascript:/data: scheme must never be stored.
  const jsUpdate = await updateCompanyProfile(victim, victimCo.id, {
    website: "javascript:alert(document.cookie)",
  });
  if (jsUpdate.website !== null) {
    throw new Error(
      `SECURITY FAIL: a javascript: website was not cleared (got ${JSON.stringify(jsUpdate.website)})`,
    );
  }
  ok("a javascript: website is coerced to null at write time — never stored, deterministically cleared");
  const okUpdate = await updateCompanyProfile(victim, victimCo.id, {
    website: "https://victim.example",
  });
  if (okUpdate.website !== "https://victim.example") {
    throw new Error("SECURITY FAIL: a legitimate https website was not stored");
  }
  passed += 1;
  logger.info("allowed ✔ a normal https website is stored");

  logger.info("=== 21. A wrong magic-link token does not burn the live link ===");
  // Redeeming used to delete every token for the email before comparing the
  // secret, so anyone who knew a password-less account's address could loop
  // the public redeem action and invalidate each newly issued link — a
  // persistent lockout. The consume now deletes only a matching token.
  const mlEmail = `sec-magic-${stamp}@example.com`;
  await registerUser({ email: mlEmail, password: "magic-pw-1234", name: "Magic User", role: "buyer" });
  const link = await requestMagicLink(mlEmail, "https://example.test", "sv");
  const realToken = link.devUrl ? new URL(link.devUrl).searchParams.get("token") : null;
  if (!realToken) throw new Error("Seed/email: no dev magic link was issued");
  if ((await consumeMagicLink(mlEmail, "definitely-the-wrong-token")) !== null) {
    throw new Error("SECURITY FAIL: a wrong magic-link token authenticated");
  }
  ok("a wrong magic-link token is rejected");
  const ownerId = await consumeMagicLink(mlEmail, realToken);
  if (!ownerId) {
    throw new Error("SECURITY FAIL: a wrong-token attempt burned the owner's live link");
  }
  passed += 1;
  logger.info("allowed ✔ the owner's real link still works after a wrong-token attempt (no lockout)");

  logger.info("=== 22. Presigned uploads are size-capped ===");
  // A presigned PUT that signed only bucket/key/type let one supplier stream
  // an arbitrarily large object into the shared bucket. The size is now
  // declared, capped, and signed as Content-Length.
  await denied(
    () =>
      createUpload(ops, {
        companyId: victimCo.id, fileName: "huge.bin",
        contentType: "application/octet-stream", contentLength: 1024 * 1024 * 1024,
      }),
    "a 1 GiB upload is refused before any presigned URL is minted",
  );
  await denied(
    () =>
      createUpload(ops, {
        companyId: victimCo.id, fileName: "zero.bin",
        contentType: "application/octet-stream", contentLength: 0,
      }),
    "a non-positive content length is refused",
  );
  await allowed(
    () =>
      createUpload(ops, {
        companyId: victimCo.id, fileName: "ok.pdf",
        contentType: "application/pdf", contentLength: 2048,
      }),
    "a normal-sized upload still mints a presigned URL",
  );

  logger.info("=== 23. Self-registration cannot be used to squat an email ===");
  // A squatter can self-register an unused email — password + live session —
  // before anyone proves they own it. That must not grant lasting access:
  // the password never signs in until the mailbox is verified, and the first
  // proof clears it and revokes every earlier session. The verified owner can
  // then set their own password.
  const sqEmail = `sec-squat-${stamp}@example.com`;
  const sqUser = await registerUser({
    email: sqEmail, password: "squatter-password-123", name: "Squatter", role: "buyer",
  });
  // Even with the correct password, an unverified account cannot sign in.
  const preVerify = await signInWithPassword(sqEmail, "squatter-password-123");
  if (preVerify.ok) {
    throw new Error("SECURITY FAIL: an unverified account signed in with a password");
  }
  ok("a password does not sign in until the mailbox is verified");
  const sqSession = await createSession(sqUser.id);
  if (!(await resolveSession(sqSession.token))) throw new Error("test setup: expected a live session");
  const sqLink = await requestMagicLink(sqEmail, "https://example.test", "sv");
  const sqToken = sqLink.devUrl ? new URL(sqLink.devUrl).searchParams.get("token") : null;
  if (!sqToken) throw new Error("Seed/email: no dev magic link was issued");
  await consumeMagicLink(sqEmail, sqToken);
  if (await resolveSession(sqSession.token)) {
    throw new Error("SECURITY FAIL: a session predating mailbox proof survived it");
  }
  ok("proving the mailbox revokes every session that predates the proof");
  const afterProof = await db.query.users.findFirst({ where: eq(users.id, sqUser.id) });
  if (afterProof?.passwordHash !== null) {
    throw new Error("SECURITY FAIL: a password set before mailbox proof survived it");
  }
  ok("…and clears the password set before the mailbox was proven");
  // The verified owner signs in afresh and sets their own password.
  const ownerSession = await createSession(sqUser.id);
  await setPassword(ownerSession.token, "brand-new-owner-pw-123");
  const afterSet = await db.query.users.findFirst({ where: eq(users.id, sqUser.id) });
  if (!afterSet?.passwordHash) {
    throw new Error("SECURITY FAIL: the verified owner could not set a password");
  }
  passed += 1;
  logger.info("allowed ✔ a verified owner can set their own password afterwards");

  logger.info(`\nSecurity test passed ✔ — ${passed} attack paths verified as blocked`);
  await pool.end();
}

main().catch(async (error) => {
  logger.error(error, "SECURITY TEST FAILED");
  await pool.end().catch(() => undefined);
  process.exit(1);
});
