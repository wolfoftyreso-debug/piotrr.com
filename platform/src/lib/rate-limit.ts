/**
 * Rate limiting on public endpoints (Section 4.7). Fixed-window in-memory
 * limiter — correct for the one-container deployment of Phase 0–1; swap the
 * store when the app scales out.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/**
 * Expired windows are dead weight, and nothing external ever prunes them:
 * an earlier version exported a "periodic cleanup" function that no code
 * called, so every address that ever touched a limited endpoint lived in
 * this map for the life of the process — a slow memory leak an attacker
 * with an IPv6 /64 could turn into a deliberate one, one counter per
 * address. Pruning is therefore wired into `rateLimit` itself, where it
 * cannot be forgotten: a full sweep at most once a minute, and immediately
 * if the map grows implausibly large between sweeps.
 */
const PRUNE_INTERVAL_MS = 60_000;
const PRUNE_SIZE_TRIGGER = 10_000;
let lastPruneAt = 0;

export interface RateLimitOptions {
  /** Max requests per window */
  limit: number;
  /** Window length in milliseconds */
  windowMs: number;
}

export function rateLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions,
  now: number = Date.now(),
): { allowed: boolean; remaining: number; resetAt: number } {
  if (now - lastPruneAt >= PRUNE_INTERVAL_MS || windows.size >= PRUNE_SIZE_TRIGGER) {
    lastPruneAt = now;
    pruneRateLimitWindows(now);
  }

  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  existing.count += 1;
  const allowed = existing.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  };
}

/** Clear one counter — used when a sign-in succeeds. */
export function resetRateLimit(key: string): void {
  windows.delete(key);
}

/** Drop expired windows. Called from `rateLimit` itself — see above. */
export function pruneRateLimitWindows(now: number = Date.now()): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

/** Exported for the test that pins the pruning actually happening. */
export function rateLimitWindowCount(): number {
  return windows.size;
}

/**
 * The client address to rate-limit on.
 *
 * `X-Forwarded-For` is a list the client can seed: anything a browser
 * sends arrives on the *left*, and each proxy appends the address it
 * actually saw on the right. Reading the first entry — the obvious
 * reading, and the one this code used to do — lets an attacker send a
 * fresh fake address per request and walk straight past every limit.
 *
 * So count from the right instead. With one reverse proxy in front of the
 * app (the k3s ingress), the last entry is the peer the ingress saw and
 * cannot be forged by the client. `TRUSTED_PROXY_HOPS` says how many
 * proxies append to the header; if the header is shorter than that, the
 * request did not traverse the expected chain and is bucketed under a
 * single shared key rather than trusted.
 */
const TRUSTED_HOPS = (() => {
  const raw = Number(process.env.TRUSTED_PROXY_HOPS ?? "1");
  return Number.isSafeInteger(raw) && raw >= 1 ? raw : 1;
})();

export function clientIp(headers: {
  get(name: string): string | null;
}): string {
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) {
    // No proxy in front (local dev, or a direct hit). One shared bucket is
    // the safe answer: better to over-limit than to trust a forged value.
    return "direct";
  }
  const hops = forwarded
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const candidate = hops[hops.length - TRUSTED_HOPS];
  return candidate ?? "untrusted-chain";
}
