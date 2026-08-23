/**
 * Demo data set (M4): ten realistic Baltic test suppliers driven through the
 * real service layer — no shortcuts past RBAC, state machines or audit.
 *
 * Distribution:
 *   6 fully verified (badge visible)   2 in review   1 expired   1 draft
 * Plus buyers, RFQs across the pipeline, offers with frozen snapshots and
 * one recorded deal — enough to exercise every screen.
 *
 * Idempotent-ish: skips companies that already exist by name.
 */
import { eq } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { logger } from "@/lib/logger";
import { users } from "@/modules/identity/schema";
import { companies } from "@/modules/companies/schema";
import { getCorridorBySlug, listTrades } from "@/modules/catalog/service";
import {
  addWorker,
  createCapacityListing,
  createCompany,
} from "@/modules/companies/service";
import { registerUser } from "@/modules/identity/service";
import {
  getCaseWithItems,
  openCase,
  runExpirySweep,
  transitionCase,
  transitionItem,
} from "@/modules/verification/service";
import { verificationItems } from "@/modules/verification/schema";
import {
  createRfq,
  dispatchRfq,
  findOrCreateBuyer,
  qualifyRfq,
} from "@/modules/rfq/service";
import { acceptOffer, recordDeal, submitOffer } from "@/modules/offers/service";
import { getOrCreateThread, sendMessage } from "@/modules/messaging/service";
import type { Actor } from "@/modules/identity/rbac";

const SUPPLIERS = [
  { name: "Vilnius Weldworks UAB", country: "LT", city: "Vilnius", reg: "301111111", vat: "LT100011111111", state: "verified", founded: 2009, headcount: 42, langs: ["lt", "en", "ru"], desc: "TIG/MIG welding teams for stainless and carbon steel. EN 1090 EXC3 workshop, offshore experience." },
  { name: "Kaunas Steel Fitters UAB", country: "LT", city: "Kaunas", reg: "302222222", vat: "LT100022222222", state: "verified", founded: 2012, headcount: 28, langs: ["lt", "en"], desc: "Industrial fitting and pipework crews. Pressure equipment directive experience, PED cat III/IV." },
  { name: "Baltic Marine Welding UAB", country: "LT", city: "Klaipėda", reg: "303333333", vat: "LT100033333333", state: "verified", founded: 2015, headcount: 35, langs: ["lt", "en", "ru"], desc: "Shipyard-grade welders: aluminium, thin plate, classification society approvals." },
  { name: "Riga Industrial Assembly SIA", country: "LV", city: "Riga", reg: "40003333444", vat: "LV40003333444", state: "verified", founded: 2011, headcount: 55, langs: ["lv", "en", "ru"], desc: "Turnkey mechanical assembly crews for factories and process lines." },
  { name: "Tallinn Metal Crafts OÜ", country: "EE", city: "Tallinn", reg: "12345678", vat: "EE101234567", state: "verified", founded: 2016, headcount: 19, langs: ["et", "en"], desc: "Precision welding and stainless fabrication, food-industry hygiene standards." },
  { name: "Šiauliai Structural Steel UAB", country: "LT", city: "Šiauliai", reg: "304444444", vat: "LT100044444444", state: "verified", founded: 2008, headcount: 61, langs: ["lt", "en", "pl"], desc: "Structural steel erection teams, EN 1090 EXC2/EXC3, high-rise experience." },
  { name: "Panevėžys Pipe Pros UAB", country: "LT", city: "Panevėžys", reg: "305555555", vat: "LT100055555555", state: "in_review", founded: 2018, headcount: 14, langs: ["lt", "en"], desc: "District heating and industrial pipework. Orbital welding capability." },
  { name: "Daugavpils Welding Bureau SIA", country: "LV", city: "Daugavpils", reg: "40005555666", vat: "LV40005555666", state: "in_review", founded: 2019, headcount: 12, langs: ["lv", "ru", "en"], desc: "Certified welders for railway and heavy machinery repair." },
  { name: "Klaipėda Offshore Crew UAB", country: "LT", city: "Klaipėda", reg: "306666666", vat: "LT100066666666", state: "expired", founded: 2013, headcount: 23, langs: ["lt", "en"], desc: "Offshore hookup and commissioning crews. GWO certified." },
  { name: "Alytus Fabrication UAB", country: "LT", city: "Alytus", reg: "307777777", vat: "LT100077777777", state: "draft", founded: 2021, headcount: 8, langs: ["lt", "en"], desc: "Young fabrication shop specializing in agricultural equipment repair." },
] as const;

async function main() {
  const admin = await db.query.users.findFirst({
    where: eq(users.email, "admin@piotrr.example"),
  });
  if (!admin) throw new Error("Run npm run db:seed first");
  const ops: Actor = { userId: admin.id, role: "admin" };

  /** Each supplier's case belongs to its own home corridor — a Latvian
   *  company is verified against Latvian institutions, not Lithuanian ones. */
  const corridorByCountry = new Map<string, string>();
  for (const home of ["LT", "PL", "LV", "EE"]) {
    const c = await getCorridorBySlug(`${home.toLowerCase()}-se`);
    if (!c) throw new Error(`Corridor ${home.toLowerCase()}-se missing`);
    corridorByCountry.set(home, c.id);
  }
  const trades = await listTrades();
  const welding = trades.find((t) => t.slug === "welding")!;
  const fitting = trades.find((t) => t.slug === "industrial-fitting")!;

  const validUntil = new Date(Date.now() + 200 * 24 * 3600 * 1000);
  const companiesByName = new Map<string, string>();

  for (const [index, spec] of SUPPLIERS.entries()) {
    const existing = await db.query.companies.findFirst({
      where: eq(companies.name, spec.name),
    });
    if (existing) {
      companiesByName.set(spec.name, existing.id);
      // Keep the owner's mailbox marked proven on a re-seed too, so password
      // sign-in (which now requires it) keeps working for the demo accounts.
      await db
        .update(users)
        .set({ emailVerifiedAt: new Date() })
        .where(eq(users.email, `supplier${index + 1}@demo.piotrr.example`));
      logger.info(`skip existing: ${spec.name}`);
      continue;
    }

    // Supplier owner account (password: demo — change in real envs)
    let ownerId: string | undefined;
    try {
      const owner = await registerUser({
        email: `supplier${index + 1}@demo.piotrr.example`,
        password: "demo-password-123",
        name: `${spec.name} owner`,
        role: "supplier",
      });
      ownerId = owner.id;
    } catch {
      const owner = await db.query.users.findFirst({
        where: eq(users.email, `supplier${index + 1}@demo.piotrr.example`),
      });
      ownerId = owner?.id;
    }
    // Demo owners sign in with a password (tests, walkthroughs). Password
    // sign-in now requires a proven mailbox, so mark these verified —
    // whether the account was just created or already existed (idempotent).
    if (ownerId) {
      await db
        .update(users)
        .set({ emailVerifiedAt: new Date() })
        .where(eq(users.id, ownerId));
    }

    const company = await createCompany(ops, {
      name: spec.name,
      country: spec.country,
      city: spec.city,
      registrationNumber: spec.reg,
      vatNumber: spec.vat,
      description: spec.desc,
      yearFounded: spec.founded,
      headcount: spec.headcount,
      languages: [...spec.langs],
    });
    companiesByName.set(spec.name, company.id);
    if (ownerId) {
      await db
        .update(companies)
        .set({ ownerUserId: ownerId })
        .where(eq(companies.id, company.id));
    }

    // Workers: 3 per company
    const workerIds: string[] = [];
    for (let w = 1; w <= 3; w++) {
      const worker = await addWorker(ops, {
        companyId: company.id,
        name: `Worker ${w} (${spec.name.split(" ")[0]})`,
        tradeRole: w === 3 ? "fitter" : "welder",
      });
      workerIds.push(worker.id);
    }

    if (spec.state === "draft") continue;

    const corridorId = corridorByCountry.get(spec.country);
    if (!corridorId) throw new Error(`No corridor seeded for ${spec.country}`);
    const kase = await openCase(ops, {
      companyId: company.id,
      corridorId,
      workerIds,
    });
    const items = (await getCaseWithItems(kase.id))!.items;
    await transitionCase(ops, kase.id, "in_review");

    if (spec.state === "in_review") {
      // Half the documents submitted, waiting in the review queue
      for (const item of items.slice(0, Math.ceil(items.length / 2))) {
        await transitionItem(ops, item.id, "submitted", { validUntil });
      }
      continue;
    }

    // verified + expired paths: approve everything
    for (const item of items) {
      await transitionItem(ops, item.id, "submitted", {
        validUntil,
        metadata: { approval_date: "2026-02-01", insurer: "BTA Baltic", status: "member" },
      });
      await transitionItem(ops, item.id, "in_review");
      await transitionItem(ops, item.id, "approved", { decisionNote: "evidence reviewed (demo seed)" });
    }
    await transitionCase(ops, kase.id, "verified");

    // Capacity listings for verified companies
    await createCapacityListing(ops, {
      companyId: company.id,
      tradeId: index % 2 === 0 ? welding.id : fitting.id,
      headcount: 4 + (index % 5),
      certificationsSummary: "ISO 9606-1: 135/136/141",
      earliestStart: new Date(Date.now() + (14 + index * 3) * 24 * 3600 * 1000),
      weeksAvailable: 6 + index,
      baseLocation: spec.city,
      publish: true,
    });

    if (spec.state === "expired") {
      // Lapse one critical document; the nightly sweep expires the case
      const first = items[0]!;
      await db
        .update(verificationItems)
        .set({ validUntil: new Date(Date.now() - 24 * 3600 * 1000) })
        .where(eq(verificationItems.id, first.id));
    }
  }

  await runExpirySweep(new Date());

  // -------------------------------------------------------------------------
  // Demand side: buyers + RFQs across the pipeline
  // -------------------------------------------------------------------------
  const buyer1 = await findOrCreateBuyer("bygg.ab@demo.example", "Bygg & Montage Sverige AB");
  const buyer2 = await findOrCreateBuyer("verft.no@demo.example", "Vestland Verft AS");
  const buyer3 = await findOrCreateBuyer("smede.dk@demo.example", "Jysk Industri ApS");

  const rfqNew = await createRfq(buyer2.userId, {
    title: "Aluminium welders for hull sections — Bergen",
    description: "Yard in Bergen needs 8 aluminium welders for hull section assembly. Class survey environment. Norwegian HSE card process handled with our support.",
    siteCity: "Bergen", siteCountry: "NO", tradeId: welding.id,
    headcountNeeded: 8, durationWeeks: 12, workingLanguage: "en",
  });
  void rfqNew;

  const rfqQualified = await createRfq(buyer3.userId, {
    title: "Pipe fitters for dairy plant retrofit — Aarhus",
    description: "Retrofit of process piping at a dairy plant near Aarhus. Hygienic welding standards required. 6 fitters, start in six weeks.",
    siteCity: "Aarhus", siteCountry: "DK", tradeId: fitting.id,
    headcountNeeded: 6, durationWeeks: 10, workingLanguage: "en",
    budgetAmountMinor: 85_000_000, budgetCurrency: "EUR",
  });
  await qualifyRfq(ops, rfqQualified.id);

  const rfqDeal = await createRfq(buyer1.userId, {
    title: "Stainless pipework crew — Västerås",
    description: "Stainless steel pipework at our Västerås plant. EN 1090 EXC2, 6 welders, 8 weeks, start ASAP. Site induction provided.",
    siteCity: "Västerås", siteCountry: "SE", tradeId: welding.id,
    headcountNeeded: 6, durationWeeks: 8, workingLanguage: "en",
    budgetAmountMinor: 120_000_000, budgetCurrency: "SEK",
  });
  await qualifyRfq(ops, rfqDeal.id);

  const vilniusId = companiesByName.get("Vilnius Weldworks UAB")!;
  const kaunasId = companiesByName.get("Kaunas Steel Fitters UAB")!;
  await dispatchRfq(ops, rfqDeal.id, [vilniusId, kaunasId], "Strong fit — buyer is ready to start");

  // Offers from both dispatched suppliers (via their owner accounts)
  const owner1 = await db.query.users.findFirst({
    where: eq(users.email, "supplier1@demo.piotrr.example"),
  });
  const owner2 = await db.query.users.findFirst({
    where: eq(users.email, "supplier2@demo.piotrr.example"),
  });
  if (owner1 && owner2) {
    const vilniusWorkers = await db.query.companies.findFirst({ where: eq(companies.id, vilniusId) });
    void vilniusWorkers;
    const { listWorkers } = await import("@/modules/companies/service");
    const w1 = await listWorkers(vilniusId);
    const w2 = await listWorkers(kaunasId);

    const offer1 = await submitOffer(
      { userId: owner1.id, role: "supplier" },
      {
        rfqId: rfqDeal.id, rateModel: "fixed", amountMinor: 98_000_000,
        currency: "SEK", note: "Includes WPQR documentation, site induction and lodging.",
        workerIds: w1.slice(0, 2).map((w) => w.id),
      },
    );
    await submitOffer(
      { userId: owner2.id, role: "supplier" },
      {
        rfqId: rfqDeal.id, rateModel: "hourly", amountMinor: 68_500,
        currency: "SEK", note: "Hourly rate per fitter, min 6 weeks commitment.",
        workerIds: w2.slice(0, 2).map((w) => w.id),
      },
    );

    // Buyer ↔ supplier thread
    const thread = await getOrCreateThread(
      { userId: buyer1.userId, role: "buyer" }, rfqDeal.id, vilniusId,
    );
    await sendMessage({ userId: buyer1.userId, role: "buyer" }, thread.id, "Can you mobilize by week 34?");
    await sendMessage({ userId: owner1.id, role: "supplier" }, thread.id, "Yes — crew of 6 available from week 33. A1 certificates already in place.");

    // Accept + record the deal
    await acceptOffer({ userId: buyer1.userId, role: "buyer" }, offer1.id);
    await recordDeal(ops, {
      offerId: offer1.id, contractValueMinor: 98_000_000, currency: "SEK",
      successFeePct: 8, note: "Demo deal — Västerås stainless pipework",
    });
  }

  logger.info("demo seed complete: 10 suppliers, 3 buyers, 3 RFQs, offers, 1 deal");
  await pool.end();
}

main().catch((error) => {
  logger.error(error, "demo seed failed");
  process.exit(1);
});
