import { describe, expect, it } from "vitest";
import {
  clientIp,
  pruneRateLimitWindows,
  rateLimit,
  rateLimitWindowCount,
  resetRateLimit,
} from "./rate-limit";

/** Minimal stand-in for the Headers object the routes hand us. */
function h(forwarded: string | null) {
  return { get: (name: string) => (name === "x-forwarded-for" ? forwarded : null) };
}

describe("rate limiter", () => {
  const opts = { limit: 3, windowMs: 60_000 };

  it("allows up to the limit within a window", () => {
    const key = `k1-${Math.random()}`;
    const t0 = 1_000_000;
    expect(rateLimit(key, opts, t0).allowed).toBe(true);
    expect(rateLimit(key, opts, t0 + 1).allowed).toBe(true);
    expect(rateLimit(key, opts, t0 + 2).allowed).toBe(true);
    expect(rateLimit(key, opts, t0 + 3).allowed).toBe(false);
  });

  it("resets after the window elapses", () => {
    const key = `k2-${Math.random()}`;
    const t0 = 2_000_000;
    for (let i = 0; i < 4; i++) rateLimit(key, opts, t0 + i);
    expect(rateLimit(key, opts, t0 + 60_001).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    const t0 = 3_000_000;
    for (let i = 0; i < 4; i++) rateLimit(a, opts, t0 + i);
    expect(rateLimit(a, opts, t0 + 10).allowed).toBe(false);
    expect(rateLimit(b, opts, t0 + 10).allowed).toBe(true);
  });

  it("prunes expired windows", () => {
    const key = `k3-${Math.random()}`;
    const t0 = 4_000_000;
    rateLimit(key, opts, t0);
    pruneRateLimitWindows(t0 + 120_000);
    // After pruning, a fresh window starts
    expect(rateLimit(key, opts, t0 + 120_001).remaining).toBe(2);
  });

  it("clears a counter on demand, so a correct password unlocks the account", () => {
    const key = `k4-${Math.random()}`;
    const t0 = 5_000_000;
    for (let i = 0; i < 4; i++) rateLimit(key, opts, t0 + i);
    expect(rateLimit(key, opts, t0 + 10).allowed).toBe(false);
    resetRateLimit(key);
    expect(rateLimit(key, opts, t0 + 11).allowed).toBe(true);
  });
});

describe("client address used as the limiter key", () => {
  it("reads the address the trusted proxy appended, not the one the client sent", () => {
    // The client seeded three fake hops; our ingress appended the truth.
    expect(clientIp(h("1.1.1.1, 2.2.2.2, 3.3.3.3, 198.51.100.7"))).toBe("198.51.100.7");
  });

  it("gives one attacker one bucket however they rewrite the header", () => {
    // The bypass this replaced: a fresh left-most value per request meant
    // a fresh counter per request, i.e. no limit at all.
    const seen = new Set(
      [
        "10.0.0.1, 198.51.100.7",
        "203.0.113.9, 198.51.100.7",
        "8.8.8.8, 198.51.100.7",
      ].map((value) => clientIp(h(value))),
    );
    expect(seen.size).toBe(1);
  });

  it("does not trust a bare header with no proxy hop", () => {
    // One entry with TRUSTED_PROXY_HOPS=1 is the proxy's own observation.
    expect(clientIp(h("198.51.100.7"))).toBe("198.51.100.7");
    // Nothing at all means nothing to trust: one shared bucket.
    expect(clientIp(h(null))).toBe("direct");
    expect(clientIp(h("  ,  "))).toBe("untrusted-chain");
  });
});

describe("the window map does not grow forever", () => {
  // The bug this pins: a "periodic cleanup" function existed and nothing
  // called it, so every address that ever hit a limited endpoint stayed
  // in memory for the life of the process. Pruning now runs inside
  // rateLimit itself; this test fails if that wiring is ever removed.
  it("prunes expired windows during normal use, with no external call", () => {
    const t0 = 1_000_000_000_000; // a fixed "now" — no wall clock in tests
    for (let i = 0; i < 50; i++) {
      rateLimit(`prune-probe:${i}`, { limit: 5, windowMs: 1_000 }, t0);
    }
    const before = rateLimitWindowCount();
    expect(before).toBeGreaterThanOrEqual(50);

    // 61s later every probe window has long expired; the next ordinary
    // call must sweep them out as a side effect.
    rateLimit("prune-probe:fresh", { limit: 5, windowMs: 1_000 }, t0 + 61_000);
    expect(rateLimitWindowCount()).toBeLessThan(before);
    expect(
      rateLimit("prune-probe:0", { limit: 5, windowMs: 1_000 }, t0 + 61_500).remaining,
      "a pruned key starts a fresh window",
    ).toBe(4);
  });
});
