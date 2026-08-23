import { beforeEach, describe, expect, it } from "vitest";
import { counter, gauge, observe, render, resetMetrics } from "./metrics";

/**
 * The registry renders a scrape format a machine parses. A malformed
 * line is not a cosmetic problem: Prometheus drops the whole scrape, so
 * one bad label silently removes every metric.
 */
describe("metrics registry", () => {
  beforeEach(() => resetMetrics());

  it("renders counters with HELP and TYPE", () => {
    counter("jobs_completed_total", "Job runs that finished", { job: "expiry" });
    counter("jobs_completed_total", "Job runs that finished", { job: "expiry" });
    const out = render();
    expect(out).toContain("# TYPE jobs_completed_total counter");
    expect(out).toContain('jobs_completed_total{job="expiry"} 2');
  });

  it("keeps label sets apart, and does not split one by key order", () => {
    counter("c", "h", { a: "1", b: "2" });
    counter("c", "h", { b: "2", a: "1" }); // same series, written the other way round
    counter("c", "h", { a: "9", b: "2" });
    const out = render();
    expect(out).toContain('c{a="1",b="2"} 2');
    expect(out).toContain('c{a="9",b="2"} 1');
  });

  it("renders histograms with cumulative buckets and +Inf", () => {
    observe("d", "h", 0.2, { job: "scan" }, [0.1, 0.5, 1]);
    observe("d", "h", 0.7, { job: "scan" }, [0.1, 0.5, 1]);
    const out = render();
    expect(out).toContain('d_bucket{job="scan",le="0.1"} 0');
    expect(out).toContain('d_bucket{job="scan",le="0.5"} 1');
    expect(out).toContain('d_bucket{job="scan",le="1"} 2');
    expect(out).toContain('d_bucket{job="scan",le="+Inf"} 2');
    expect(out).toContain('d_count{job="scan"} 2');
  });

  it("escapes label values that would otherwise break the format", () => {
    gauge("app_info", "h", 1, { version: 'v1"; DROP\nthings' });
    const out = render();
    // One line per series, and the quote is escaped rather than closing early.
    expect(out.split("\n").filter((l) => l.startsWith("app_info")).length).toBe(1);
    expect(out).toContain('\\"');
    expect(out).not.toContain("\napp_info{version=\"v1\";");
  });

  it("gauges replace rather than accumulate", () => {
    gauge("q", "h", 5);
    gauge("q", "h", 2);
    expect(render()).toContain("q 2");
  });
});
