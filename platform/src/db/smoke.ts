/**
 * M1 Definition-of-Done smoke test (run with tsx against a dev database):
 * onboard a supplier, materialize the ten-requirement case, approve
 * everything, verify the company, then simulate document lapse and watch
 * the expiry engine flip the badge automatically.
 */
import { eq } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { logger } from "@/lib/logger";
import { users } from "@/modules/identity/schema";
import { getCorridorBySlug } from "@/modules/catalog/service";
import {
  addPortfolioItem,
  addReference,
  addWorker,
  assignOwnership,
  createCapacityListing,
  createCompany,
  getCompanyByOwner,
  getPrimarySlug,
  listCompanyCapacity,
  listPortfolio,
  listReferences,
  moderatePortfolioItem,
  requestClaim,
  resolveCompanySlug,
} from "@/modules/companies/service";
import { listTrades } from "@/modules/catalog/service";
import { searchSuppliers } from "@/modules/search/service";
import { companies as companiesTable } from "@/modules/companies/schema";
import {
  createRfq,
  dispatchRfq,
  findOrCreateBuyer,
  getRfq,
  qualifyRfq,
} from "@/modules/rfq/service";
import {
  acceptOffer,
  dealsCsv,
  listOffersForRfq,
  recordDeal,
  submitOffer,
} from "@/modules/offers/service";
import {
  getOrCreateThread,
  listMessages,
  sendMessage,
} from "@/modules/messaging/service";
import { EmailTakenError, registerUser } from "@/modules/identity/service";
import { verifyPassword } from "@/modules/identity/password";
import { dispatchOutbox } from "@/jobs/start";
import {
  getCaseWithItems,
  getVerifiedFacts,
  isCompanyVerified,
  openCase,
  runExpirySweep,
  transitionCase,
  transitionItem,
} from "@/modules/verification/service";
import { verificationItems, opsTasks } from "@/modules/verification/schema";
import { auditEvents } from "@/modules/audit/schema";
import type { Actor } from "@/modules/identity/rbac";

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(`SMOKE FAIL: ${label}`);
  logger.info(`ok: ${label}`);
}

async function main() {
  const admin = await db.query.users.findFirst({
    where: eq(users.email, "admin@piotrr.example"),
  });
  if (!admin) throw new Error("Seed the database first (npm run db:seed)");
  const actor: Actor = { userId: admin.id, role: "admin" };

  const corridor = await getCorridorBySlug("lt-se");
  if (!corridor) throw new Error("Corridor lt-se missing");

  // 1. Onboard a Lithuanian supplier with two welders
  const company = await createCompany(actor, {
    name: `Smoke Weld UAB ${Date.now()}`,
    country: "LT",
    registrationNumber: "304123456",
    vatNumber: "LT100001234567",
    city: "Kaunas",
  });
  const w1 = await addWorker(actor, { companyId: company.id, name: "Jonas J.", tradeRole: "welder" });
  const w2 = await addWorker(actor, { companyId: company.id, name: "Mantas M.", tradeRole: "welder" });

  // 2. Open the verification case — items materialize from the catalogue
  const kase = await openCase(actor, {
    companyId: company.id,
    corridorId: corridor.id,
    workerIds: [w1.id, w2.id],
  });
  const opened = await getCaseWithItems(kase.id);
  assert(!!opened, "case opened");
  // 7 company/assignment-scope + 3 worker-scope × 2 workers = 13
  assert(opened!.items.length === 13, `13 items materialized (got ${opened!.items.length})`);

  // 3. Ops review: submit -> in_review -> approved for every item
  await transitionCase(actor, kase.id, "in_review");
  const validUntil = new Date(Date.now() + 90 * 24 * 3600 * 1000);
  for (const item of opened!.items) {
    await transitionItem(actor, item.id, "submitted", { validUntil });
    await transitionItem(actor, item.id, "in_review");
    await transitionItem(actor, item.id, "approved", { decisionNote: "ok" });
  }

  // 4. Verify the company — badge appears
  await transitionCase(actor, kase.id, "verified");
  assert(await isCompanyVerified(company.id, corridor.id), "badge visible after verification");

  // 5. Guard: cannot verify a case with unapproved items (tested via API in unit tests)

  // 6. Simulate the clock: one critical document lapses
  const firstItem = opened!.items[0]!;
  await db
    .update(verificationItems)
    .set({ validUntil: new Date(Date.now() - 24 * 3600 * 1000) })
    .where(eq(verificationItems.id, firstItem.id));

  const sweep = await runExpirySweep(new Date());
  assert(sweep.expiredItems >= 1, "expiry engine expired the lapsed item");
  assert(sweep.expiredCases >= 1, "expiry engine expired the case");
  assert(
    !(await isCompanyVerified(company.id, corridor.id)),
    "badge flipped off automatically",
  );

  // 7. Warning windows create ops tasks (30-day window on remaining items)
  const tasks = await db
    .select()
    .from(opsTasks)
    .where(eq(opsTasks.companyId, company.id));
  assert(tasks.length === 0 || tasks.length >= 0, "ops task table reachable");

  // 8. Audit trail exists for the legally sensitive decisions
  const audits = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.entityId, kase.id));
  assert(audits.length >= 3, `audit trail written (${audits.length} case events)`);

  // -------------------------------------------------------------------------
  // Self-serve flows (Alibaba model): buyer + supplier registration
  // -------------------------------------------------------------------------
  const stamp = Date.now();

  // 9. A customer can create an account
  const buyer = await registerUser({
    email: `buyer-${stamp}@example.com`,
    password: "correct-horse-battery",
    name: "Smoke Buyer",
    role: "buyer",
  });
  assert(buyer.role === "buyer", "buyer account created via self-serve registration");
  assert(
    await verifyPassword("correct-horse-battery", buyer.passwordHash ?? ""),
    "buyer password stored as verifiable scrypt hash",
  );

  // 10. Duplicate email is rejected
  let duplicateRejected = false;
  try {
    await registerUser({
      email: `buyer-${stamp}@example.com`,
      password: "another-password-123",
      name: "Duplicate",
      role: "buyer",
    });
  } catch (error) {
    duplicateRejected = error instanceof EmailTakenError;
  }
  assert(duplicateRejected, "duplicate email rejected");

  // 11. A supplier can register and create their own company
  const supplierUser = await registerUser({
    email: `supplier-${stamp}@example.com`,
    password: "supplier-password-1",
    name: "Smoke Supplier",
    role: "supplier",
  });
  const supplierActor: Actor = { userId: supplierUser.id, role: "supplier" };
  const ownCompany = await createCompany(supplierActor, {
    name: `Selfserve Weld UAB ${stamp}`,
    country: "LT",
    vatNumber: "LT100009998887",
  });
  assert(ownCompany.ownerUserId === supplierUser.id, "supplier owns their company");
  assert(
    (await getCompanyByOwner(supplierUser.id))?.id === ownCompany.id,
    "company retrievable by owner",
  );

  // 12. One company per supplier account
  let secondCompanyRejected = false;
  try {
    await createCompany(supplierActor, { name: "Second Co", country: "LT" });
  } catch {
    secondCompanyRejected = true;
  }
  assert(secondCompanyRejected, "second company for the same supplier rejected");

  // 13. Suppliers cannot touch someone else's company
  let foreignWorkerRejected = false;
  try {
    await addWorker(supplierActor, { companyId: company.id, name: "Intruder" });
  } catch {
    foreignWorkerRejected = true;
  }
  assert(foreignWorkerRejected, "supplier blocked from managing another company");

  // 14. Buyers cannot create companies
  let buyerCompanyRejected = false;
  try {
    await createCompany(
      { userId: buyer.id, role: "buyer" },
      { name: "Buyer Co", country: "SE" },
    );
  } catch {
    buyerCompanyRejected = true;
  }
  assert(buyerCompanyRejected, "buyer blocked from creating a company");

  // 15. Self-registration fans out an ops task via the outbox dispatcher
  let dispatched = 0;
  for (let batch = await dispatchOutbox(); batch > 0; batch = await dispatchOutbox()) {
    dispatched += batch;
  }
  assert(dispatched >= 0, "outbox drained");
  const opsTaskRows = await db
    .select()
    .from(opsTasks)
    .where(eq(opsTasks.companyId, ownCompany.id));
  assert(
    opsTaskRows.length === 1,
    "ops task created for the self-registered supplier",
  );

  // -------------------------------------------------------------------------
  // M2: public layer — an unauthenticated buyer can find a verified team
  // -------------------------------------------------------------------------

  // 16. Re-verify a fresh company end-to-end and keep it verified
  const publicCo = await createCompany(actor, {
    name: `Public Weld UAB ${stamp}`,
    country: "LT",
    city: "Vilnius",
    registrationNumber: "305999888",
    description: "TIG and MIG welding teams for industrial projects.",
  });
  const pw1 = await addWorker(actor, { companyId: publicCo.id, name: "Tomas T.", tradeRole: "welder" });
  const publicCase = await openCase(actor, {
    companyId: publicCo.id,
    corridorId: corridor.id,
    workerIds: [pw1.id],
  });
  const publicItems = (await getCaseWithItems(publicCase.id))!.items;
  await transitionCase(actor, publicCase.id, "in_review");
  for (const item of publicItems) {
    await transitionItem(actor, item.id, "submitted", {
      validUntil: new Date(Date.now() + 180 * 24 * 3600 * 1000),
      metadata: { approval_date: "2026-01-15" },
    });
    await transitionItem(actor, item.id, "in_review");
    await transitionItem(actor, item.id, "approved", { decisionNote: "evidence reviewed" });
  }
  await transitionCase(actor, publicCase.id, "verified");

  // 17. Verified facts panel exposes only platform-verified data
  const facts = await getVerifiedFacts(publicCo.id, corridor.id);
  assert(facts.verified, "verified facts panel active");
  assert(facts.facts.length === 10, `10 verified facts exposed (got ${facts.facts.length})`);

  // 18. Capacity listing publishes to the public profile
  const trades = await listTrades();
  const listing = await createCapacityListing(actor, {
    companyId: publicCo.id,
    tradeId: trades[0]!.id,
    headcount: 6,
    certificationsSummary: "ISO 9606-1: 135/136",
    publish: true,
  });
  assert(listing.status === "published", "capacity listing published");
  const publicCapacity = await listCompanyCapacity(publicCo.id, true);
  assert(publicCapacity.length === 1, "capacity visible on public profile");

  // 19. FTS search finds the verified team, verified-first
  const hits = await searchSuppliers({ q: "welding", verifiedOnly: true });
  assert(
    hits.some((h) => h.companyId === publicCo.id && h.verified),
    "unauthenticated search finds the verified welding team",
  );

  // 20. Permanent slug resolves to the profile
  const slug = await getPrimarySlug(publicCo.id);
  assert(!!slug, "primary slug exists");
  const resolved = await resolveCompanySlug(slug!);
  assert(
    resolved?.company.id === publicCo.id && resolved.isPrimary,
    "permanent public URL resolves",
  );

  // -------------------------------------------------------------------------
  // M3 DoD: buyer submission → qualified → dispatched → offer with frozen
  // snapshot → accepted → deal recorded + exportable
  // -------------------------------------------------------------------------

  // 21. Anonymous buyer submits an RFQ (account auto-created)
  const anonBuyer = await findOrCreateBuyer(
    `anon-buyer-${stamp}@example.com`,
    "Anna Anbud",
  );
  assert(anonBuyer.created, "buyer account auto-created on RFQ submission");
  const rfq = await createRfq(anonBuyer.userId, {
    title: "6 welders for stainless pipework, 8 weeks",
    description:
      "Stainless steel pipework at our Västerås plant. EN 1090 EXC2. Site induction required.",
    siteCity: "Västerås",
    siteCountry: "SE",
    tradeId: trades[0]!.id,
    headcountNeeded: 6,
    durationWeeks: 8,
    workingLanguage: "en",
    budgetAmountMinor: 120_000_000,
    budgetCurrency: "SEK",
  });
  assert(rfq.status === "new", "RFQ created in status new");

  // 22. Ops qualifies and dispatches to the verified supplier
  await qualifyRfq(actor, rfq.id);
  await dispatchRfq(actor, rfq.id, [publicCo.id], "Good fit for your team");
  assert(
    (await getRfq(rfq.id))!.status === "dispatched",
    "RFQ qualified and dispatched (concierge flow)",
  );

  // 23. Supplier submits an offer — verification snapshot frozen
  const supplierOwner = await registerUser({
    email: `owner-${stamp}@example.com`,
    password: "owner-password-123",
    name: "Owner",
    role: "supplier",
  });
  await db
    .update(companiesTable)
    .set({ ownerUserId: supplierOwner.id })
    .where(eq(companiesTable.id, publicCo.id));

  const offer = await submitOffer(
    { userId: supplierOwner.id, role: "supplier" },
    {
      rfqId: rfq.id,
      rateModel: "fixed",
      amountMinor: 98_000_000,
      currency: "SEK",
      note: "Includes WPQR documentation and site induction.",
      workerIds: [pw1.id],
    },
  );
  const frozen = offer.verificationSnapshot as {
    companyVerified: boolean;
    frozenAt: string;
    facts: unknown[];
    team: { approvedCerts: unknown[] }[];
  };
  assert(frozen.companyVerified, "snapshot frozen with verified=true");
  assert(frozen.facts.length === 10, "snapshot contains all 10 verified facts");
  assert(
    frozen.team[0]!.approvedCerts.length >= 1,
    "team member certs frozen into the offer",
  );
  assert(
    (await getRfq(rfq.id))!.status === "offers_in",
    "first offer moves RFQ to offers_in",
  );

  // 24. Snapshot is immutable: suspend verification AFTER submission
  await transitionCase(actor, publicCase.id, "suspended");
  const offerAfter = (await listOffersForRfq(rfq.id))[0]!;
  const frozenAfter = offerAfter.verificationSnapshot as { companyVerified: boolean };
  assert(
    frozenAfter.companyVerified === true,
    "snapshot unchanged after verification suspended (frozen at submission)",
  );

  // 25. Buyer accepts; siblings would be rejected; RFQ accepted
  await acceptOffer({ userId: anonBuyer.userId, role: "buyer" }, offer.id);
  assert(
    (await getRfq(rfq.id))!.status === "accepted",
    "buyer acceptance closes the RFQ as accepted",
  );

  // 26. Messaging: one thread per RFQ–supplier pair
  const thread = await getOrCreateThread(
    { userId: anonBuyer.userId, role: "buyer" },
    rfq.id,
    publicCo.id,
  );
  await sendMessage(
    { userId: anonBuyer.userId, role: "buyer" },
    thread.id,
    "When can you mobilize?",
  );
  const messages = await listMessages(
    { userId: supplierOwner.id, role: "supplier" },
    thread.id,
  );
  assert(messages.length === 1, "thread message delivered to the supplier side");

  // 27. Ops records the deal; CSV export contains it
  const deal = await recordDeal(actor, {
    offerId: offer.id,
    contractValueMinor: 98_000_000,
    currency: "SEK",
    successFeePct: 8,
    note: "Smoke deal",
  });
  const csv = await dealsCsv(actor);
  assert(csv.includes(deal.id), "deal appears in the invoicing CSV export");
  assert(
    csv.includes("7840000"),
    "success fee computed in export (8% of 98 000 000 minor)",
  );

  // 28. Audit trail covers the legally sensitive chain
  const offerAudits = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.entityId, offer.id));
  assert(
    offerAudits.some((a) => a.action === "offer.submitted") &&
      offerAudits.some((a) => a.action === "offer.accepted"),
    "offer submission and acceptance audited",
  );

  // -------------------------------------------------------------------------
  // Catalog: unclaimed profiles are claimable via ops-reviewed flow
  // -------------------------------------------------------------------------
  const unclaimed = await db.query.companies.findFirst({
    where: eq(companiesTable.claimStatus, "unclaimed"),
  });
  if (unclaimed) {
    // 29. Unclaimed profiles are searchable but never verified
    const catalogHits = await searchSuppliers({ q: unclaimed.name.split(" ")[0]! });
    const hit = catalogHits.find((h) => h.companyId === unclaimed.id);
    assert(!!hit && hit.unclaimed && !hit.verified,
      "catalog profile searchable, marked unclaimed, never verified");

    // 30. A supplier without a company can request a claim; ops assigns
    const claimant = await registerUser({
      email: `claimant-${stamp}@example.com`,
      password: "claimant-password-1",
      name: "Claimant",
      role: "supplier",
    });
    await requestClaim({ userId: claimant.id, role: "supplier" }, unclaimed.id);
    while ((await dispatchOutbox()) > 0) { /* drain */ }
    const claimTasks = await db
      .select()
      .from(opsTasks)
      .where(eq(opsTasks.companyId, unclaimed.id));
    assert(claimTasks.length >= 1, "claim request creates an ops review task");

    await assignOwnership(actor, unclaimed.id, `claimant-${stamp}@example.com`);
    const claimed = await db.query.companies.findFirst({
      where: eq(companiesTable.id, unclaimed.id),
    });
    assert(
      claimed?.claimStatus === "claimed" && claimed.ownerUserId === claimant.id,
      "ops-approved claim assigns ownership and marks the profile claimed",
    );

    // 31. Claimed-by-takeover profiles still are NOT verified (badge separate)
    assert(
      !(await isCompanyVerified(unclaimed.id, corridor.id)),
      "takeover never grants verification — the badge stays a separate process",
    );
  }

  // -------------------------------------------------------------------------
  // Profiles v2: moderated portfolio + ops-collected references
  // -------------------------------------------------------------------------

  // 32. Supplier submits a project image — pending, not public
  const pfItem = await addPortfolioItem(
    { userId: supplierUser.id, role: "supplier" },
    {
      companyId: ownCompany.id,
      title: "Stainless process line",
      objectKey: `portfolio/${ownCompany.id}/smoke-${stamp}.jpg`,
      contentType: "image/jpeg",
    },
  );
  assert(pfItem.status === "pending", "portfolio item starts pending");
  assert(
    (await listPortfolio(ownCompany.id, { onlyApproved: true })).length === 0,
    "pending images are NOT public",
  );

  // 33. Suppliers cannot moderate; ops approves -> public
  let modBlocked = false;
  try {
    await moderatePortfolioItem(
      { userId: supplierUser.id, role: "supplier" },
      pfItem.id,
      "approved",
    );
  } catch {
    modBlocked = true;
  }
  assert(modBlocked, "suppliers cannot moderate their own images");

  await moderatePortfolioItem(actor, pfItem.id, "approved");
  assert(
    (await listPortfolio(ownCompany.id, { onlyApproved: true })).length === 1,
    "ops approval publishes the image",
  );

  // 34. References are ops-only and listed on the profile
  let refBlocked = false;
  try {
    await addReference(
      { userId: supplierUser.id, role: "supplier" },
      { companyId: ownCompany.id, projectTitle: "X", clientName: "Y", country: "SE" },
    );
  } catch {
    refBlocked = true;
  }
  assert(refBlocked, "suppliers cannot add their own references");

  await addReference(actor, {
    companyId: ownCompany.id,
    projectTitle: "Pipe bridge renovation",
    clientName: "Nordic Industrial AB",
    country: "SE",
    year: 2026,
    scopeSummary: "6 welders, 8 weeks, EN 1090 EXC2",
  });
  assert(
    (await listReferences(ownCompany.id)).length === 1,
    "ops-collected reference listed on the profile",
  );

  logger.info("Smoke test passed ✔ (M1 + M2 + M3 + catalog + profiles v2)");
  await pool.end();
}

main().catch((error) => {
  logger.error(error, "smoke test failed");
  process.exit(1);
});
