import { describe, expect, it } from "vitest";
import { jsonLdScript } from "./jsonld";
import { safeObjectName } from "@/modules/documents/service";

/**
 * Pure-function security regressions. The database-backed attacks
 * (IDOR, cross-tenant writes) are exercised in src/db/security-test.ts,
 * which runs them as a real attacker against real rows.
 */

describe("JSON-LD embedding (stored XSS)", () => {
  it("neutralises a script-closing company name", () => {
    // A supplier controls their company name; without escaping this
    // breaks out of <script type="application/ld+json"> on a public page.
    const out = jsonLdScript({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("\\u003c");
  });

  it("keeps the payload parseable after escaping", () => {
    const value = { name: 'Weld & Co <UAB>', city: "Vilnius" };
    expect(JSON.parse(jsonLdScript(value))).toEqual(value);
  });

  it("escapes line terminators that are legal JSON but break JS", () => {
    const out = jsonLdScript({ note: "a b c" });
    expect(out).not.toContain(" ");
    expect(out).not.toContain(" ");
    expect(JSON.parse(out).note).toBe("a b c");
  });
});

describe("object key construction (path traversal)", () => {
  it("strips a traversing filename down to its base name", () => {
    expect(safeObjectName("../../other-company/secret.pdf")).toBe("secret.pdf");
    expect(safeObjectName("..\\..\\windows\\evil.exe")).toBe("evil.exe");
  });

  it("refuses to produce an absolute or dot-leading name", () => {
    expect(safeObjectName("/etc/passwd")).toBe("passwd");
    expect(safeObjectName("...")).toBe("file");
    expect(safeObjectName("")).toBe("file");
  });

  it("removes characters that could confuse a storage path", () => {
    const out = safeObjectName("a b?c#d%e&f.pdf");
    expect(out).not.toMatch(/[ ?#%&]/);
    expect(out.endsWith(".pdf")).toBe(true);
  });

  it("bounds the length so a key cannot be inflated", () => {
    expect(safeObjectName("x".repeat(500)).length).toBeLessThanOrEqual(120);
  });

  it("keeps an ordinary filename readable", () => {
    expect(safeObjectName("A1-certificate_2026.pdf")).toBe("A1-certificate_2026.pdf");
  });
});

describe("bearer secret comparison", () => {
  // METRICS_TOKEN and CRON_SECRET used `!==`, which exits at the first
  // differing byte and turns response timing into an oracle over the
  // secret's prefix. secretEquals hashes both sides and compares the
  // digests with timingSafeEqual — same work no matter where they differ.
  it("accepts the right secret and rejects wrong, empty and missing ones", async () => {
    const { secretEquals } = await import("./auth");
    expect(secretEquals("s3cr3t-token", "s3cr3t-token")).toBe(true);
    expect(secretEquals("s3cr3t-tokeX", "s3cr3t-token")).toBe(false);
    expect(secretEquals("s3cr3t", "s3cr3t-token")).toBe(false); // shorter
    expect(secretEquals("", "s3cr3t-token")).toBe(false);
    expect(secretEquals(null, "s3cr3t-token")).toBe(false);
    expect(secretEquals(undefined, "s3cr3t-token")).toBe(false);
  });
});

describe("bounded JSON bodies", () => {
  // Measured before the fix: a 20 MB POST to a public endpoint was
  // buffered and parsed in full before validation refused it.
  it("refuses a declared oversize before reading anything", async () => {
    const { readJsonBody, BodyTooLargeError } = await import("./api");
    const request = new Request("http://test.local/x", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(10_000_000) },
      body: '{"a":1}',
    });
    await expect(readJsonBody(request)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("cuts off a stream that exceeds the budget, header or no header", async () => {
    const { readJsonBody, BodyTooLargeError } = await import("./api");
    // A chunked body that never declares its size and keeps coming.
    const chunk = new TextEncoder().encode('"' + "x".repeat(64 * 1024));
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ > 100) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const request = new Request("http://test.local/x", {
      method: "POST",
      body: endless,
      // @ts-expect-error duplex is required by undici for streamed bodies
      duplex: "half",
    });
    await expect(readJsonBody(request)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("parses a normal body exactly as request.json() did", async () => {
    const { readJsonBody } = await import("./api");
    const request = new Request("http://test.local/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Svets i Västerås", n: 3 }),
    });
    await expect(readJsonBody(request)).resolves.toEqual({ title: "Svets i Västerås", n: 3 });
  });
});

describe("request-id hygiene", () => {
  // The header is client-writable and flows into the audit trail.
  it("honours ids that look like ids and nothing else", async () => {
    const { acceptableRequestId } = await import("./request-context");
    expect(acceptableRequestId("3f2a77aa-1c4e-4b0e-9d55-0a1b2c3d4e5f")).toBe(true);
    expect(acceptableRequestId("req_2026.08.21-abc")).toBe(true);
    expect(acceptableRequestId('"><script>alert(1)</script>')).toBe(false);
    expect(acceptableRequestId("short")).toBe(false);
    expect(acceptableRequestId("x".repeat(129))).toBe(false);
    expect(acceptableRequestId(null)).toBe(false);
  });
});
