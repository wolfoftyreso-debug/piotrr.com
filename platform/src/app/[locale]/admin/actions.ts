"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { currentActor } from "@/lib/auth";
import { requireAnyRole } from "@/modules/identity/rbac";
import {
  addContact,
  addReference,
  addWorker,
  assignOwnership,
  createCompany,
  moderatePortfolioItem,
} from "@/modules/companies/service";
import {
  openCase,
  transitionCase,
  transitionItem,
} from "@/modules/verification/service";
import { opsTasks } from "@/modules/verification/schema";
import type { CaseState, ItemStatus } from "@/modules/verification/domain";

async function actor() {
  const a = await currentActor();
  return requireAnyRole(a, ["ops", "admin"]);
}

const companySchema = z.object({
  name: z.string().min(2),
  country: z.string().length(2),
  registrationNumber: z.string().optional(),
  vatNumber: z.string().optional(),
  city: z.string().optional(),
});

export async function createCompanyAction(formData: FormData) {
  const a = await actor();
  const input = companySchema.parse({
    name: formData.get("name"),
    country: String(formData.get("country") ?? "").toUpperCase(),
    registrationNumber: formData.get("registrationNumber") || undefined,
    vatNumber: formData.get("vatNumber") || undefined,
    city: formData.get("city") || undefined,
  });
  await createCompany(a, input);
  revalidatePath("/[locale]/admin/companies", "page");
}

export async function addWorkerAction(formData: FormData) {
  const a = await actor();
  await addWorker(a, {
    companyId: z.string().uuid().parse(formData.get("companyId")),
    name: z.string().min(1).parse(formData.get("name")),
    tradeRole: String(formData.get("tradeRole") ?? "") || undefined,
  });
  revalidatePath("/[locale]/admin/companies/[id]", "page");
}

export async function addContactAction(formData: FormData) {
  const a = await actor();
  await addContact(a, {
    companyId: z.string().uuid().parse(formData.get("companyId")),
    name: z.string().min(1).parse(formData.get("name")),
    email: String(formData.get("email") ?? "") || undefined,
    phone: String(formData.get("phone") ?? "") || undefined,
    roleTitle: String(formData.get("roleTitle") ?? "") || undefined,
  });
  revalidatePath("/[locale]/admin/companies/[id]", "page");
}

export async function assignOwnershipAction(formData: FormData) {
  const a = await actor();
  await assignOwnership(
    a,
    z.string().uuid().parse(formData.get("companyId")),
    z.string().email().parse(formData.get("ownerEmail")),
  );
  revalidatePath("/[locale]/admin/companies/[id]", "page");
}

export async function moderatePortfolioAction(formData: FormData) {
  const a = await actor();
  await moderatePortfolioItem(
    a,
    z.string().uuid().parse(formData.get("itemId")),
    z.enum(["approved", "rejected"]).parse(formData.get("decision")),
    String(formData.get("note") ?? "") || undefined,
  );
  revalidatePath("/[locale]/admin/companies/[id]", "page");
}

export async function addReferenceAction(formData: FormData) {
  const a = await actor();
  const year = String(formData.get("year") ?? "");
  await addReference(a, {
    companyId: z.string().uuid().parse(formData.get("companyId")),
    projectTitle: z.string().min(2).parse(formData.get("projectTitle")),
    clientName: z.string().min(2).parse(formData.get("clientName")),
    country: z.string().length(2).parse(String(formData.get("country") ?? "").toUpperCase()),
    year: year ? Number(year) : undefined,
    scopeSummary: String(formData.get("scopeSummary") ?? "") || undefined,
  });
  revalidatePath("/[locale]/admin/companies/[id]", "page");
}

export async function openCaseAction(formData: FormData) {
  const a = await actor();
  await openCase(a, {
    companyId: z.string().uuid().parse(formData.get("companyId")),
    corridorId: z.string().uuid().parse(formData.get("corridorId")),
    workerIds: formData
      .getAll("workerIds")
      .map((w) => z.string().uuid().parse(w)),
  });
  revalidatePath("/[locale]/admin", "layout");
}

export async function transitionCaseAction(formData: FormData) {
  const a = await actor();
  const caseId = z.string().uuid().parse(formData.get("caseId"));
  const to = z
    .enum(["draft", "in_review", "verified", "suspended", "expired"])
    .parse(formData.get("to")) as CaseState;
  await transitionCase(a, caseId, to);
  revalidatePath("/[locale]/admin", "layout");
}

export async function transitionItemAction(formData: FormData) {
  const a = await actor();
  const itemId = z.string().uuid().parse(formData.get("itemId"));
  const to = z
    .enum(["missing", "submitted", "in_review", "approved", "rejected", "expired"])
    .parse(formData.get("to")) as ItemStatus;
  const validUntilRaw = String(formData.get("validUntil") ?? "");
  await transitionItem(a, itemId, to, {
    decisionNote: String(formData.get("decisionNote") ?? "") || undefined,
    validUntil: validUntilRaw ? new Date(validUntilRaw) : undefined,
  });
  revalidatePath("/[locale]/admin", "layout");
}

export async function completeTaskAction(formData: FormData) {
  await actor();
  const taskId = z.string().uuid().parse(formData.get("taskId"));
  await db
    .update(opsTasks)
    .set({ status: "done", updatedAt: new Date() })
    .where(eq(opsTasks.id, taskId));
  revalidatePath("/[locale]/admin/tasks", "page");
}
