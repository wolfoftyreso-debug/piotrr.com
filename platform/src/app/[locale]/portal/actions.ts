"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentActor } from "@/lib/auth";
import { requireRole } from "@/modules/identity/rbac";
import {
  addWorker,
  createCapacityListing,
  createCompany,
  getCompanyByOwner,
  setCapacityStatus,
  updateCompanyProfile,
} from "@/modules/companies/service";
import { confirmUpload, createUpload, presignPut } from "@/modules/documents/service";
import { addPortfolioItem, PORTFOLIO_PREFIX } from "@/modules/companies/service";
import { transitionItem } from "@/modules/verification/service";

export async function createMyCompanyAction(formData: FormData) {
  const actor = requireRole(await currentActor(), "supplier");
  await createCompany(actor, {
    name: z.string().min(2).parse(formData.get("name")),
    country: z
      .string()
      .length(2)
      .parse(String(formData.get("country") ?? "").toUpperCase()),
    registrationNumber: String(formData.get("registrationNumber") ?? "") || undefined,
    vatNumber: String(formData.get("vatNumber") ?? "") || undefined,
    city: String(formData.get("city") ?? "") || undefined,
    description: String(formData.get("description") ?? "") || undefined,
  });
  revalidatePath("/[locale]/portal", "page");
}

export async function addMyWorkerAction(formData: FormData) {
  const actor = requireRole(await currentActor(), "supplier");
  await addWorker(actor, {
    companyId: z.string().uuid().parse(formData.get("companyId")),
    name: z.string().min(1).parse(formData.get("name")),
    tradeRole: String(formData.get("tradeRole") ?? "") || undefined,
  });
  revalidatePath("/[locale]/portal", "page");
}

export async function updateMyProfileAction(formData: FormData) {
  const actor = requireRole(await currentActor(), "supplier");
  const company = await getCompanyByOwner(actor.userId);
  if (!company) throw new Error("No company for this account");

  const yearFounded = String(formData.get("yearFounded") ?? "");
  const headcount = String(formData.get("headcount") ?? "");
  await updateCompanyProfile(actor, company.id, {
    description: String(formData.get("description") ?? "") || undefined,
    city: String(formData.get("city") ?? "") || undefined,
    website: String(formData.get("website") ?? "") || undefined,
    yearFounded: yearFounded ? Number(yearFounded) : null,
    headcount: headcount ? Number(headcount) : null,
    languages: formData
      .getAll("languages")
      .map(String)
      .filter((l) => /^[a-z]{2}$/.test(l)),
    certifications: String(formData.get("certifications") ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean)
      .slice(0, 20),
    awards: String(formData.get("awards") ?? "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean)
      .slice(0, 20),
    serviceAreas: String(formData.get("serviceAreas") ?? "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean)
      .slice(0, 20),
  });
  revalidatePath("/[locale]/portal", "page");
}

export async function createMyCapacityAction(formData: FormData) {
  const actor = requireRole(await currentActor(), "supplier");
  const company = await getCompanyByOwner(actor.userId);
  if (!company) throw new Error("No company for this account");

  const earliestStart = String(formData.get("earliestStart") ?? "");
  const weeksAvailable = String(formData.get("weeksAvailable") ?? "");
  await createCapacityListing(actor, {
    companyId: company.id,
    tradeId: z.string().uuid().parse(formData.get("tradeId")),
    headcount: z.coerce.number().int().min(1).parse(formData.get("headcount")),
    certificationsSummary:
      String(formData.get("certificationsSummary") ?? "") || undefined,
    earliestStart: earliestStart ? new Date(earliestStart) : null,
    weeksAvailable: weeksAvailable ? Number(weeksAvailable) : null,
    baseLocation: String(formData.get("baseLocation") ?? "") || undefined,
    publish: formData.get("publish") === "on",
    indicativeRateMinMinor: Number(formData.get("rateMin")) * 100 || null,
    indicativeRateMaxMinor: Number(formData.get("rateMax")) * 100 || null,
    indicativeRateCurrency: String(formData.get("rateCurrency") ?? "") || null,
    indicativeRateUnit: String(formData.get("rateUnit") ?? "") || null,
  });
  revalidatePath("/[locale]/portal", "page");
}

export async function archiveMyCapacityAction(formData: FormData) {
  const actor = requireRole(await currentActor(), "supplier");
  await setCapacityStatus(
    actor,
    z.string().uuid().parse(formData.get("listingId")),
    "archived",
  );
  revalidatePath("/[locale]/portal", "page");
}

/** Portfolio step 1: presigned PUT for a project image */
export async function requestPortfolioUploadAction(input: {
  fileName: string;
  contentType: string;
  contentLength: number;
}): Promise<{ objectKey: string; uploadUrl: string }> {
  const actor = requireRole(await currentActor(), "supplier");
  const company = await getCompanyByOwner(actor.userId);
  if (!company) throw new Error("No company for this account");
  if (!/^image\//.test(input.contentType)) {
    throw new Error("Only images can be added to the portfolio");
  }
  return presignPut(
    `${PORTFOLIO_PREFIX}/${company.id}`,
    z.string().min(1).max(200).parse(input.fileName),
    z.string().min(3).max(100).parse(input.contentType),
    z.coerce.number().int().positive().parse(input.contentLength),
  );
}

/** Portfolio step 2: register the item — stays pending until ops approves */
export async function createPortfolioItemAction(input: {
  title: string;
  description?: string;
  objectKey: string;
  contentType: string;
}): Promise<void> {
  const actor = requireRole(await currentActor(), "supplier");
  const company = await getCompanyByOwner(actor.userId);
  if (!company) throw new Error("No company for this account");
  await addPortfolioItem(actor, {
    companyId: company.id,
    title: z.string().min(2).max(140).parse(input.title),
    description: input.description
      ? z.string().max(1000).parse(input.description)
      : undefined,
    objectKey: z.string().min(5).parse(input.objectKey),
    contentType: z.string().parse(input.contentType),
  });
  revalidatePath("/[locale]/portal", "page");
}

/** Step 1 of evidence upload: presigned PUT URL (expires ≤ 15 min) */
export async function requestUploadUrlAction(input: {
  fileName: string;
  contentType: string;
  documentType?: string;
  contentLength: number;
}): Promise<{ documentId: string; uploadUrl: string }> {
  const actor = requireRole(await currentActor(), "supplier");
  const company = await getCompanyByOwner(actor.userId);
  if (!company) throw new Error("No company for this account");

  const { document, uploadUrl } = await createUpload(actor, {
    companyId: company.id,
    fileName: z.string().min(1).max(200).parse(input.fileName),
    contentType: z.string().min(3).max(100).parse(input.contentType),
    documentType: input.documentType,
    contentLength: z.coerce.number().int().positive().parse(input.contentLength),
  });
  return { documentId: document.id, uploadUrl };
}

/** Step 2: attach the uploaded document and submit the item for review */
export async function submitItemEvidenceAction(input: {
  itemId: string;
  documentId: string;
  validUntil?: string;
}): Promise<void> {
  const actor = requireRole(await currentActor(), "supplier");
  // The PUT has landed — queue the malware scan before the item is reviewed.
  await confirmUpload(z.string().uuid().parse(input.documentId));
  await transitionItem(actor, z.string().uuid().parse(input.itemId), "submitted", {
    documentIds: [z.string().uuid().parse(input.documentId)],
    validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
  });
  revalidatePath("/[locale]/portal", "page");
}

export interface SetPasswordState {
  ok?: boolean;
  error?: "invalid" | "not_signed_in";
}

/** Set (or replace) the signed-in user's own password. Any role — this is
 *  the recovery path after a magic-link verification clears a pre-proof
 *  password. */
export async function setPasswordAction(
  _prev: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  // Identify the caller by the LIVE session token, not a pre-resolved actor:
  // setPassword re-validates and locks that session inside the write, so a
  // session revoked by a concurrent mailbox proof cannot restore a password.
  // Read the cookie under the SAME name the session was set with —
  // `__Host-bb_session` in production, bare `bb_session` in dev — not the raw
  // base name, or the token is invisible in production and recovery never runs.
  const { cookies } = await import("next/headers");
  const { sessionCookieName } = await import("@/lib/auth");
  const token = (await cookies()).get(sessionCookieName)?.value;
  if (!token) return { error: "not_signed_in" };
  const password = String(formData.get("password") ?? "");
  try {
    const { setPassword } = await import("@/modules/identity/service");
    await setPassword(token, password);
    return { ok: true };
  } catch {
    return { error: "invalid" };
  }
}
