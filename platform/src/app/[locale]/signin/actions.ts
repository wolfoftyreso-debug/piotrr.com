"use server";

import { headers } from "next/headers";
import { requestMagicLink } from "@/modules/identity/magic-link";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Ask for an email sign-in link. Always reports success so the form cannot
 * be used to discover which addresses have accounts.
 */
export async function requestMagicLinkAction(
  _prev: { sent: boolean; devUrl?: string } | null,
  formData: FormData,
): Promise<{ sent: boolean; devUrl?: string }> {
  const email = String(formData.get("email") ?? "").trim();
  const locale = String(formData.get("locale") ?? "sv");
  if (!email) return { sent: false };

  const head = await headers();
  const ip = clientIp(head);
  const limited = rateLimit(`magic-link:${ip}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  if (!limited.allowed) {
    return { sent: true }; // silently throttled — same response shape
  }

  const configuredBase = process.env.PUBLIC_BASE_URL;
  if (!configuredBase && process.env.NODE_ENV === "production") {
    // Boot config already refuses to start without PUBLIC_BASE_URL; this is
    // the belt-and-suspenders that guarantees a sign-in link's origin is
    // never taken from the attacker-controlled Host header, even if that
    // guard were somehow bypassed. Same response shape, so nothing leaks.
    return { sent: true };
  }
  const base = configuredBase ?? `http://${head.get("host") ?? "localhost:3000"}`;
  const result = await requestMagicLink(email, base, locale);
  return { sent: true, devUrl: result.devUrl };
}

/**
 * Password sign-in. Rate-limited per address so the form cannot be used
 * as an offline oracle, and every failure returns the same shape.
 */
export async function passwordSignInAction(
  email: string,
  password: string,
): Promise<{ ok: boolean }> {
  const head = await headers();
  const ip = clientIp(head);
  const limited = rateLimit(`signin:${ip}`, { limit: 10, windowMs: 15 * 60 * 1000 });
  if (!limited.allowed) return { ok: false };

  const { signInWithPassword } = await import("@/lib/auth");
  const result = await signInWithPassword(email, password);
  return { ok: result.ok };
}

/** Redeem an email link. The token is single-use and burned on success. */
export async function magicLinkSignInAction(
  email: string,
  token: string,
): Promise<{ ok: boolean }> {
  // Defence in depth: the redeem only consumes a token whose hash matches
  // (so a wrong token can no longer burn the owner's live link), but the
  // action is still public, so cap attempts per address to stop a hammering
  // loop from probing it at all.
  const head = await headers();
  const ip = clientIp(head);
  const limited = rateLimit(`magic-redeem:${ip}`, { limit: 20, windowMs: 15 * 60 * 1000 });
  if (!limited.allowed) return { ok: false };

  const { signInWithMagicLink } = await import("@/lib/auth");
  const result = await signInWithMagicLink(email, token);
  return { ok: result.ok };
}
