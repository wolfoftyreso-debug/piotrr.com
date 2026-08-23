"use server";

import { headers } from "next/headers";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  EmailTakenError,
  registerUser,
} from "@/modules/identity/service";

export interface RegisterFormState {
  error?: "email_taken" | "rate_limited" | "invalid";
  ok?: boolean;
}

export async function registerAction(
  _prev: RegisterFormState,
  formData: FormData,
): Promise<RegisterFormState> {
  const headerList = await headers();
  const ip =
    clientIp(headerList);
  const limited = rateLimit(`register:${ip}`, {
    limit: 10,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.allowed) return { error: "rate_limited" };

  try {
    const user = await registerUser({
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      name: String(formData.get("name") ?? ""),
      role: formData.get("role") === "supplier" ? "supplier" : "buyer",
    });
    // Sign the new account in here rather than round-tripping the
    // password back to the client to authenticate a second time.
    const { startSessionForUser } = await import("@/lib/auth");
    await startSessionForUser(user.id);
    return { ok: true };
  } catch (error) {
    if (error instanceof EmailTakenError) return { error: "email_taken" };
    return { error: "invalid" };
  }
}
