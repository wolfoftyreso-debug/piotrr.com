import { describe, it, expect } from "vitest";
import { safeHttpUrl } from "./url";

describe("safeHttpUrl", () => {
  it("accepts ordinary http and https links", () => {
    expect(safeHttpUrl("https://example.com")).toBe("https://example.com");
    expect(safeHttpUrl("http://example.com/path?q=1")).toBe(
      "http://example.com/path?q=1",
    );
    expect(safeHttpUrl("  https://example.com  ")).toBe("https://example.com");
  });

  it("rejects script- and data-bearing schemes", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("JavaScript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeHttpUrl("vbscript:msgbox(1)")).toBeNull();
    expect(safeHttpUrl("file:///etc/passwd")).toBeNull();
  });

  it("rejects empty, malformed, and missing values", () => {
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
    expect(safeHttpUrl("   ")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
  });
});
