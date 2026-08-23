/**
 * Failure-path and concurrency test (run with tsx against a seeded database).
 *
 *   npm run db:seed && npx tsx src/db/failure-test.ts
 *
 * The other suites walk the happy path and the attack paths. This one asks
 * the question neither does: what happens when two people do the right
 * thing at the same moment, or when a dependency the code assumes is there
 * is not?
 *
 * Every case here is written to *fail the system*, not to demonstrate it.
 * A case that cannot fail is not a test, so each asserts a specific
 * outcome — exactly one winner, no orphaned state, an error the caller can
 * act on rather than a stack trace.
 */
import { spawnSync } from "node:child_process";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { logger } from "@/lib/logger";
import { users } from "@/modules/identity/schema";
import { getCorridorBySlug } from "@/modules/catalog/service";
import { addWorker, createCompany } from "@/modules/companies/service";
import {
  createRfq,
  dispatchRfq,
  findOrCreateBuyer,
  getRfq,
  qualifyRfq,
} from "@/modules/rfq/service";
import { acceptOffer, expireStaleOffers, listOffersForRfq, submitOffer } from "@/modules/offers/service";
import { registerUser, setPassword } from "@/modules/identity/service";
import { createSession } from "@/modules/identity/session";
import { consumeMagicLink, requestMagicLink } from "@/modules/identity/magic-link";
import {
  getCaseWithItems,
  openCase,
  transitionCase,
  transitionItem,
} from "@/modules/verification/service";
import { offers as offersTable } from "@/modules/offers/schema";
import type { Actor } from "@/modules/identity/rbac";

let passed = 0;
function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(`FAILURE-TEST FAIL: ${label}`);
  passed += 1;
  logger.info(`ok: ${label}`);
}

/** Run both, and report which settled how — neither is expected to win. */
async function race<T>(a: Promise<T>, b: Promise<T>) {
  const [ra, rb] = await Promise.allSettled([a, b]);
  const won = [ra, rb].filter((r) => r.status === "fulfilled").length;
  const lost = [ra, rb].filter((r) => r.status === "rejected");
  return { won, lost: lost as PromiseRejectedResult[] };
}

const stamp = Date.now();
const DAY = 24 * 3600 * 1000;

async function verifyEverything(actor: Actor, caseId: string, validUntil: Date) {
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
  if (!corridor) throw new Error("Corridor lt-se missing");
  const farFuture = new Date(Date.now() + 365 * DAY);

  // ------------------------------------------------------------------
  logger.info("--- 1. Two suppliers, one RFQ, both offers accepted at once ---");
  // The money case. If both accepts succeed the buyer has committed to two
  // contractors for one job, and the deal export bills for both.
  const supA = await registerUser({
    email: `fail-a-${stamp}@example.com`, password: "failure-password-123",
    name: "Race A", role: "supplier",
  });
  const supB = await registerUser({
    email: `fail-b-${stamp}@example.com`, password: "failure-password-123",
    name: "Race B", role: "supplier",
  });
  const actorA: Actor = { userId: supA.id, role: "supplier" };
  const actorB: Actor = { userId: supB.id, role: "supplier" };

  const coA = await createCompany(actorA, { name: `Race Alpha UAB ${stamp}`, country: "LT", city: "Kaunas" });
  const coB = await createCompany(actorB, { name: `Race Beta UAB ${stamp}`, country: "LT", city: "Vilnius" });
  const wA = await addWorker(ops, { companyId: coA.id, name: "Ra Ra", tradeRole: "welder" });
  const wB = await addWorker(ops, { companyId: coB.id, name: "Rb Rb", tradeRole: "welder" });
  await verifyEverything(ops, (await openCase(ops, { companyId: coA.id, corridorId: corridor.id, workerIds: [wA.id] })).id, farFuture);
  await verifyEverything(ops, (await openCase(ops, { companyId: coB.id, corridorId: corridor.id, workerIds: [wB.id] })).id, farFuture);

  const buyer = await findOrCreateBuyer(`fail-buyer-${stamp}@example.com`, "Race Buyer AB");
  const rfq = await createRfq(buyer.userId, {
    title: `Race condition test ${stamp}`,
    description: "Two offers, accepted simultaneously.",
    siteAddress: "Testgatan 1, Västerås",
    siteCity: "Västerås",
    siteCountry: "SE",
    headcountNeeded: 4,
    startDate: new Date(Date.now() + 30 * DAY),
    durationWeeks: 6,
    workingLanguage: "en",
  });
  await qualifyRfq(ops, rfq.id);
  await dispatchRfq(ops, rfq.id, [coA.id, coB.id]);

  const offerA = await submitOffer(actorA, {
    rfqId: rfq.id, rateModel: "hourly",
    amountMinor: 42_00, currency: "EUR", earliestStart: new Date(Date.now() + 30 * DAY),
    validUntil: farFuture, workerIds: [wA.id], note: "A",
  });
  const offerB = await submitOffer(actorB, {
    rfqId: rfq.id, rateModel: "hourly",
    amountMinor: 44_00, currency: "EUR", earliestStart: new Date(Date.now() + 30 * DAY),
    validUntil: farFuture, workerIds: [wB.id], note: "B",
  });

  const buyerActor: Actor = { userId: buyer.userId, role: "buyer" };
  const result = await race(
    acceptOffer(buyerActor, offerA.id),
    acceptOffer(buyerActor, offerB.id),
  );
  logger.info(
    { fulfilled: result.won, rejected: result.lost.map((l) => String(l.reason).slice(0, 120)) },
    "concurrent accept settled",
  );

  const after = await listOffersForRfq(rfq.id);
  const accepted = after.filter((o) => o.status === "accepted");
  assert(accepted.length === 1, `exactly one offer is accepted (got ${accepted.length})`);
  assert(
    after.filter((o) => o.status === "submitted").length === 0,
    "no offer is left dangling in submitted after the race",
  );
  const rfqAfter = await getRfq(rfq.id);
  assert(rfqAfter!.status === "accepted", "the RFQ itself is closed as accepted exactly once");
  assert(
    result.lost.length === 1,
    `the losing accept is reported as an error, not silently ignored (rejected: ${result.lost.length})`,
  );
  // A deadlock or serialization failure is a database-level message the
  // caller cannot act on. The loser should be told what is actually true:
  // the offer is no longer acceptable.
  const reason = String(result.lost[0]?.reason ?? "");
  assert(
    !/deadlock|could not serialize|40P01|40001/i.test(reason),
    `the loser gets a domain error, not a raw database fault (got: ${reason.slice(0, 160)})`,
  );

  // ------------------------------------------------------------------
  logger.info("--- 2. Two reviewers approve the same verification item ---");
  // Double-approval must not write two audit rows claiming two decisions,
  // and must not move an already-approved item again.
  // A third account: one supplier account owns at most one company, which
  // is the product rule — reusing actorA here fails for the right reason.
  const supC = await registerUser({
    email: `fail-c-${stamp}@example.com`, password: "failure-password-123",
    name: "Race C", role: "supplier",
  });
  const actorC: Actor = { userId: supC.id, role: "supplier" };
  const coC = await createCompany(actorC, { name: `Race Gamma UAB ${stamp}`, country: "LT", city: "Klaipeda" });
  const wC = await addWorker(ops, { companyId: coC.id, name: "Rc Rc", tradeRole: "welder" });
  const caseC = await openCase(ops, { companyId: coC.id, corridorId: corridor.id, workerIds: [wC.id] });
  await transitionCase(ops, caseC.id, "in_review");
  const itemsC = (await getCaseWithItems(caseC.id))!.items;
  const target = itemsC[0]!;
  await transitionItem(ops, target.id, "submitted", {});
  await transitionItem(ops, target.id, "in_review", {});

  const approve = await race(
    transitionItem(ops, target.id, "approved", { validUntil: farFuture, decisionNote: "evidence reviewed" }),
    transitionItem(ops, target.id, "approved", { validUntil: farFuture, decisionNote: "evidence reviewed" }),
  );
  assert(approve.won === 1, `only one approval succeeds (got ${approve.won})`);
  const reviewed = (await getCaseWithItems(caseC.id))!.items.find((i) => i.id === target.id)!;
  assert(reviewed.status === "approved", "the item is approved exactly once");

  // ------------------------------------------------------------------
  logger.info("--- 3. Accepting an offer that was already accepted ---");
  await (async () => {
    try {
      await acceptOffer(buyerActor, accepted[0]!.id);
      throw new Error("FAILURE-TEST FAIL: re-accepting an accepted offer succeeded");
    } catch (error) {
      const message = String(error);
      assert(
        !message.includes("FAILURE-TEST FAIL"),
        "re-accepting an already accepted offer is refused",
      );
      assert(
        !/deadlock|40P01/i.test(message),
        "the refusal is a domain error, not a lock fault",
      );
    }
  })();

  // ------------------------------------------------------------------
  logger.info("--- 4. Offers on an RFQ that is already closed ---");
  await (async () => {
    try {
      await submitOffer(actorB, {
        rfqId: rfq.id, rateModel: "hourly",
        amountMinor: 39_00, currency: "EUR", earliestStart: new Date(Date.now() + 30 * DAY),
        validUntil: farFuture, workerIds: [wB.id], note: "late",
      });
      throw new Error("FAILURE-TEST FAIL: an offer landed on a closed RFQ");
    } catch (error) {
      assert(
        !String(error).includes("FAILURE-TEST FAIL"),
        "a late offer on a closed RFQ is refused",
      );
    }
  })();

  // ------------------------------------------------------------------
  logger.info("--- 5. The audit trail survived the races ---");
  // Two concurrent writers must not produce two "accepted" audit rows for
  // one offer: the trail is the evidence, and a contradictory trail is
  // worse than none.
  const acceptedAudits = await db.execute(sql`
    select count(*)::int as n from audit_events
    where entity_type = 'offer' and action = 'offer.accepted'
      and entity_id = ${accepted[0]!.id}
  `);
  const auditCount = (acceptedAudits.rows[0] as { n: number }).n;
  assert(auditCount === 1, `exactly one acceptance is recorded in the audit trail (got ${auditCount})`);

  const orphanOffers = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(offersTable)
    .where(sql`${offersTable.rfqId} = ${rfq.id} and ${offersTable.status} = 'accepted'`);
  assert(orphanOffers[0]!.n === 1, "the database agrees: one accepted offer for this RFQ");

  // ------------------------------------------------------------------
  logger.info("--- 6. The mail relay is down while someone signs in ---");
  // Found by testing rather than reading: with nothing listening on the
  // SMTP port, a known address threw ECONNREFUSED and an unknown address
  // resolved cleanly — a perfect account-enumeration oracle, on the very
  // endpoint whose comment promised it could not enumerate. Both must
  // resolve identically no matter what the relay does.
  //
  // The provider is chosen from the environment parsed at PROCESS START,
  // so a dead relay is a property a process is born with — it cannot be
  // arranged by mutating process.env afterwards. The first version of
  // this case did exactly that and tested console-against-console: a
  // regression test that could not fail its subject. (CI exposed it — and
  // the restore had a second bug: assigning undefined to process.env
  // stores the string "undefined".) So the probe is a CHILD process,
  // started with the dead-relay environment.
  const probe = spawnSync(
    "npx",
    ["tsx", "src/db/enum-probe.ts", "admin@piotrr.example", `no-such-${stamp}@example.com`],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: "1", // nothing listens here
        SMTP_SECURE: "false",
      },
    },
  );
  const probeLine = `${probe.stdout}${probe.stderr}`
    .split("\n")
    .find((l) => l.startsWith("ENUM-PROBE"));
  assert(!!probeLine, `the dead-relay probe ran (exit ${probe.status})`);
  assert(
    probeLine === "ENUM-PROBE resolved resolved",
    `a dead mail relay leaks nothing about which accounts exist (${probeLine})`,
  );

  // ------------------------------------------------------------------
  logger.info("--- 7. The same magic link redeemed twice, simultaneously ---");
  // "Single use" used to be read-then-delete: two concurrent redemptions
  // could both read the row before either deleted it, and both signed in.
  // Redemption is now one atomic DELETE ... RETURNING; exactly one caller
  // may win.
  const linkResult = await requestMagicLink("admin@piotrr.example", "https://example.test", "sv");
  const tokenParam = linkResult.devUrl ? new URL(linkResult.devUrl).searchParams.get("token") : null;
  assert(!!tokenParam, "a dev magic link was issued for the race");
  const redemptions = await Promise.all([
    consumeMagicLink("admin@piotrr.example", tokenParam!),
    consumeMagicLink("admin@piotrr.example", tokenParam!),
  ]);
  const winners = redemptions.filter((r) => r !== null);
  assert(winners.length === 1, `exactly one concurrent redemption wins (got ${winners.length})`);
  assert(
    (await consumeMagicLink("admin@piotrr.example", tokenParam!)) === null,
    "the link is dead after the race",
  );


  // ------------------------------------------------------------------
  logger.info("--- 8. A buyer accepts an offer whose validity date has passed ---");
  // Measured before the guard: an offer dated yesterday was accepted
  // cleanly, binding the supplier to a price they set to lapse. The
  // supplier from case 1 is verified and dispatched; give them a second
  // RFQ and an already-expired offer.
  const rfq8 = await createRfq(buyer.userId, {
    title: `Expiry test ${stamp}`,
    description: "An offer past its validity date must not be acceptable.",
    siteCity: "Malmö", siteCountry: "SE", headcountNeeded: 2, workingLanguage: "en",
  });
  await qualifyRfq(ops, rfq8.id);
  await dispatchRfq(ops, rfq8.id, [coA.id]);
  const expiredOffer = await submitOffer(actorA, {
    rfqId: rfq8.id, rateModel: "hourly", amountMinor: 40_00, currency: "EUR",
    validUntil: new Date(Date.now() - DAY), workerIds: [wA.id], note: "stale",
  });
  try {
    await acceptOffer(buyerActor, expiredOffer.id);
    throw new Error("FAILURE-TEST FAIL: an expired offer was accepted");
  } catch (error) {
    assert(!String(error).includes("FAILURE-TEST FAIL"), "an offer past validUntil cannot be accepted");
    assert(/validity date has passed/.test(String(error)),
      "the refusal names the reason (validity date), not a state-machine fault");
  }
  // The stale offer is still "submitted", which blocks the supplier from
  // re-quoting and still shows to the buyer as live. The nightly sweep
  // flips it to "expired" — the state that existed and was never reached.
  const swept = await expireStaleOffers(new Date());
  assert(swept >= 1, "the expiry sweep flips a past-validUntil offer to expired");
  const staleAfter = (await listOffersForRfq(rfq8.id)).find((o) => o.id === expiredOffer.id);
  assert(staleAfter?.status === "expired", "the stale offer is now marked expired, not submitted");
  // With the stale offer cleared, the supplier can re-quote and the buyer accepts.
  const freshOffer = await submitOffer(actorA, {
    rfqId: rfq8.id, rateModel: "hourly", amountMinor: 41_00, currency: "EUR",
    validUntil: new Date(Date.now() + 30 * DAY), workerIds: [wA.id], note: "fresh",
  });
  const acceptedFresh = await acceptOffer(buyerActor, freshOffer.id);
  assert(acceptedFresh.status === "accepted", "a fresh in-date offer accepts once the stale one is swept");

  // ------------------------------------------------------------------
  logger.info("--- 9. A squatter races setPassword against the real owner's mailbox proof ---");
  // The attack this closes: someone self-registers an unused email, holds a
  // live session, and — the instant the real owner clicks the magic link
  // that clears the squatter's password — tries to slam a new password back
  // in. If setPassword trusted a pre-resolved actor, that write could land
  // on the account the squatter just lost. It must not: mailbox proof is the
  // one authoritative moment, and the password ends up NULL no matter which
  // side of the race schedules first.
  // setPassword and first-proof consumeMagicLink both touch the same session
  // AND user rows. If they took opposite lock orders one interleaving would
  // deadlock: Postgres kills a victim with 40P01, and because the proof's
  // token delete once lived OUTSIDE its transaction, a proof chosen as victim
  // burned the owner's live link while the squatter's password survived —
  // "proof always wins" quietly broken. Both now lock sessions before the
  // user row, so no cycle exists. Run the race several times over fresh
  // squatters to exercise both interleavings, and fail loudly on any raw
  // lock fault leaking to the caller.
  for (let i = 0; i < 6; i++) {
    const squatEmail = `fail-squat-${stamp}-${i}@example.com`;
    const squatter = await registerUser({
      email: squatEmail, password: "squatter-initial-pw-123",
      name: "Squatter", role: "buyer",
    });
    if (i === 0) {
      assert(!squatter.emailVerifiedAt, "the squatter's self-registration starts unverified");
    }
    const squatSession = await createSession(squatter.id);

    const link = await requestMagicLink(squatEmail, "https://example.test", "sv");
    const proofToken = link.devUrl ? new URL(link.devUrl).searchParams.get("token") : null;
    if (i === 0) assert(!!proofToken, "a magic link was issued to the contested address");

    // Fire both at the same instant: the owner proves the mailbox while the
    // squatter tries to re-set a password on the same session/account.
    const raced = await race(
      setPassword(squatSession.token, "squatter-reclaim-pw-999"),
      consumeMagicLink(squatEmail, proofToken!) as unknown as Promise<void>,
    );
    for (const rej of raced.lost) {
      const reason = String(rej.reason ?? "");
      assert(
        !/deadlock|could not serialize|40P01|40001/i.test(reason),
        `the race never surfaces a raw lock fault (round ${i}, got: ${reason.slice(0, 120)})`,
      );
    }

    const [proven] = await db
      .select({
        passwordHash: users.passwordHash,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.id, squatter.id))
      .limit(1);
    assert(!!proven?.emailVerifiedAt, `the mailbox proof landed (round ${i}): the account is verified`);
    assert(
      proven?.passwordHash === null,
      `mailbox proof wins the race (round ${i}): password cleared, not the squatter's (hash: ${proven?.passwordHash === null ? "null" : "present"})`,
    );
    // And the squatter's session is dead — a revoked session cannot set a
    // password afterwards either.
    try {
      await setPassword(squatSession.token, "squatter-second-try-000");
      throw new Error("FAILURE-TEST FAIL: a revoked session set a password after mailbox proof");
    } catch (error) {
      assert(
        !String(error).includes("FAILURE-TEST FAIL"),
        `a session revoked by mailbox proof can no longer set a password (round ${i})`,
      );
    }
  }

  logger.info(`\nFailure test passed ✔ — ${passed} assertions across 9 concurrency and failure paths`);
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    logger.error(error);
    await pool.end();
    process.exit(1);
  });
