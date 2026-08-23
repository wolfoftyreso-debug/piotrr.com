"use server";

import { revalidatePath } from "next/cache";
import { currentActor } from "@/lib/auth";
import {
  provisionStaffUser,
  setUserActive,
} from "@/modules/identity/service";

async function actorOrThrow() {
  const actor = await currentActor();
  if (!actor) throw new Error("Not signed in");
  return actor;
}

export async function provisionStaffAction(formData: FormData) {
  const actor = await actorOrThrow();
  await provisionStaffUser(actor, {
    email: String(formData.get("email") ?? ""),
    name: String(formData.get("name") ?? ""),
    role: String(formData.get("role") ?? "ops") === "admin" ? "admin" : "ops",
  });
  revalidatePath("/[locale]/admin/staff", "page");
}

export async function setStaffActiveAction(formData: FormData) {
  const actor = await actorOrThrow();
  await setUserActive(
    actor,
    String(formData.get("userId") ?? ""),
    String(formData.get("active") ?? "1") === "1",
  );
  revalidatePath("/[locale]/admin/staff", "page");
}

/**
 * Mint a machine credential. The plaintext is returned once, here, and
 * never again — only its digest reaches the database.
 */
export async function createApiKeyAction(
  _prev: { plaintext?: string; error?: string } | null,
  formData: FormData,
): Promise<{ plaintext?: string; error?: string }> {
  const actor = await actorOrThrow();
  const { createApiKey } = await import("@/modules/identity/api-keys");
  try {
    const { plaintext } = await createApiKey(actor, {
      name: String(formData.get("name") ?? "").trim(),
      userId: String(formData.get("userId") ?? ""),
      scopes: formData.getAll("scopes").map(String),
    });
    revalidatePath("/[locale]/admin/staff", "page");
    return { plaintext };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed" };
  }
}

export async function revokeApiKeyAction(formData: FormData) {
  const actor = await actorOrThrow();
  const { revokeApiKey } = await import("@/modules/identity/api-keys");
  await revokeApiKey(actor, String(formData.get("keyId") ?? ""));
  revalidatePath("/[locale]/admin/staff", "page");
}
