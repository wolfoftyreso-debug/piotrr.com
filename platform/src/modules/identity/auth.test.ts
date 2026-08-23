import { describe, expect, it } from "vitest";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "./password";
import { hashToken, safeEqual } from "./session";
import { API_SCOPES, hasScope, type ApiKeyPrincipal } from "./api-keys";

/**
 * Own-auth invariants (Appendix B). These are the properties that must
 * hold no matter how the surrounding code is refactored — the database
 * paths are exercised by the flow test.
 */

describe("password hashing", () => {
  it("never stores the password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(stored).not.toContain("correct horse");
    expect(stored.startsWith("scrypt$")).toBe(true);
  });

  it("writes the cost parameters into the hash, at or above the OWASP floor", async () => {
    const stored = await hashPassword("cost-params-are-recorded");
    const [, n, r, p] = stored.split("$");
    expect(Number(n)).toBeGreaterThanOrEqual(1 << 17);
    expect(Number(r)).toBeGreaterThanOrEqual(8);
    expect(Number(p)).toBeGreaterThanOrEqual(1);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const a = await hashPassword("same-password-here");
    const b = await hashPassword("same-password-here");
    expect(a).not.toEqual(b);
  });

  it("accepts the right password and rejects the wrong one", async () => {
    const stored = await hashPassword("right-password-1");
    expect(await verifyPassword("right-password-1", stored)).toBe(true);
    expect(await verifyPassword("right-password-2", stored)).toBe(false);
  });

  it("rejects a malformed or truncated hash instead of throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "scrypt:onlysalt")).toBe(false);
    expect(await verifyPassword("x", "bcrypt:a:b")).toBe(false);
    expect(await verifyPassword("x", "scrypt$notanumber$8$1$aa$bb")).toBe(false);
  });

  it("refuses parameters large enough to exhaust memory on a login", async () => {
    // A tampered row must not turn one sign-in into a denial of service.
    expect(await verifyPassword("x", `scrypt$${2 ** 30}$8$1$aa$bb`)).toBe(false);
  });

  it("still verifies hashes written under the old Node defaults", async () => {
    // Format from before cost parameters were recorded: scrypt:salt:hash.
    // Produced with Node's defaults (N=2^14, r=8, p=1, keylen=64).
    const { scrypt } = await import("node:crypto");
    const legacy = await new Promise<string>((resolve, reject) =>
      scrypt("legacy-password-x", "abcdef", 64, (e, k) =>
        e ? reject(e) : resolve(`scrypt:abcdef:${k.toString("hex")}`),
      ),
    );
    expect(await verifyPassword("legacy-password-x", legacy)).toBe(true);
    expect(await verifyPassword("wrong-password-x", legacy)).toBe(false);
    expect(needsRehash(legacy)).toBe(true);
  });

  it("does not ask for a rehash of a current hash", async () => {
    expect(needsRehash(await hashPassword("already-strong-enough"))).toBe(false);
  });

  it("uses current cost for the no-such-account hash, so timing is level", async () => {
    // A cheaper dummy would make a missing account measurably faster.
    expect(needsRehash(DUMMY_PASSWORD_HASH)).toBe(false);
    expect(await verifyPassword("anything at all", DUMMY_PASSWORD_HASH)).toBe(false);
  });
});

describe("token hashing", () => {
  it("is deterministic, so a presented token can be looked up", () => {
    expect(hashToken("abc")).toEqual(hashToken("abc"));
  });

  it("does not reveal the token", () => {
    const token = "super-secret-session-token";
    const digest = hashToken(token);
    expect(digest).not.toContain(token);
    expect(digest).toHaveLength(64); // sha-256, hex
  });

  it("separates different tokens", () => {
    expect(hashToken("a")).not.toEqual(hashToken("b"));
  });
});

describe("constant-time compare", () => {
  it("matches equal strings", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
  });

  it("rejects different strings, including different lengths", () => {
    expect(safeEqual("abc123", "abc124")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "a")).toBe(false);
  });
});

describe("api key format", () => {
  // Regression: the secret is base64url, whose alphabet contains "_".
  // Parsing by splitting on "_" tore roughly half of all real keys apart
  // and made authentication fail intermittently.
  const PATTERN = /^bb_([0-9a-f]{12})_(.+)$/;

  it("keeps a secret that contains underscores intact", () => {
    const key = "bb_0123456789ab_aB_cD-eF_gH";
    const m = PATTERN.exec(key);
    expect(m?.[1]).toBe("0123456789ab");
    expect(m?.[2]).toBe("aB_cD-eF_gH");
  });

  it("accepts every base64url character in the secret", () => {
    const secret = "abcXYZ019-_";
    const m = PATTERN.exec(`bb_0123456789ab_${secret}`);
    expect(m?.[2]).toBe(secret);
  });

  it("rejects a wrong prefix, a bad key id and a missing secret", () => {
    expect(PATTERN.exec("xx_0123456789ab_secret")).toBeNull();
    expect(PATTERN.exec("bb_NOTHEX_secret")).toBeNull();
    expect(PATTERN.exec("bb_0123456789ab_")).toBeNull();
    expect(PATTERN.exec("garbage")).toBeNull();
  });
});

describe("api key scopes", () => {
  const principal = (scopes: string[]): ApiKeyPrincipal => ({
    userId: "u",
    role: "buyer",
    keyId: "k",
    scopes,
  });

  it("grants only what was issued", () => {
    const p = principal(["companies:read"]);
    expect(hasScope(p, "companies:read")).toBe(true);
    expect(hasScope(p, "deals:read")).toBe(false);
  });

  it("grants nothing when no scope was issued", () => {
    const p = principal([]);
    for (const scope of API_SCOPES) expect(hasScope(p, scope)).toBe(false);
  });
});
