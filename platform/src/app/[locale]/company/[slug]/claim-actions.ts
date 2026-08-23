"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentActor } from "@/lib/auth";
import { requireRole } from "@/modules/identity/rbac";
import { requestClaim } from "@/modules/companies/service";

export async function requestClaimAction(formData: FormData) {
  const actor = requireRole(await currentActor(), "supplier");
  await requestClaim(actor, z.string().uuid().parse(formData.get("companyId")));
  revalidatePath("/[locale]/company/[slug]", "page");
}
