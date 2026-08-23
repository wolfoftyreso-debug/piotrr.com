/**
 * Metrics registry — Prometheus text format, no dependency.
 *
 * §33 asks what a new component buys. `prom-client` would give process
 * metrics (heap, GC, event-loop lag) for free, but pod CPU and memory
 * already come from the kubelet, and the numbers only this application
 * knows — jobs, verifications, RFQs, deals — are ones no library can
 * collect for us. That leaves a stable text format and about sixty lines
 * of rendering, against a dependency to patch, scan and upgrade. Event
 * loop lag is the one genuinely process-level signal worth having, and
 * it is a timer.
 *
 * State lives on `globalThis`, learned the hard way: Next bundles the
 * instrumentation hook, route handlers and middleware separately, so a
 * module-level Map is not one Map. A registry that silently splits in
 * two reports half the truth, which is worse than reporting none.
 */

type Labels = Record<string, string>;

interface Series {
  help: string;
  type: "counter" | "gauge" | "histogram";
  values: Map<string, number>;
  /** histogram only: bucket upper bounds, plus sum and count per label set */
  buckets?: number[];
  sums?: Map<string, number>;
  counts?: Map<string, number>;
}

const REGISTRY = Symbol.for("piotrr.metrics");
const g = globalThis as unknown as Record<symbol, Map<string, Series> | undefined>;
const registry: Map<string, Series> = (g[REGISTRY] ??= new Map());

/** Label sets are keyed by a stable, sorted encoding so order cannot split a series. */
function keyOf(labels: Labels): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}=${escapeLabel(v)}`).join(",");
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function series(name: string, help: string, type: Series["type"], buckets?: number[]): Series {
  let s = registry.get(name);
  if (!s) {
    s = { help, type, values: new Map() };
    if (type === "histogram") {
      s.buckets = buckets;
      s.sums = new Map();
      s.counts = new Map();
    }
    registry.set(name, s);
  }
  return s;
}

export function counter(name: string, help: string, labels: Labels = {}, by = 1): void {
  const s = series(name, help, "counter");
  const k = keyOf(labels);
  s.values.set(k, (s.values.get(k) ?? 0) + by);
}

export function gauge(name: string, help: string, value: number, labels: Labels = {}): void {
  const s = series(name, help, "gauge");
  s.values.set(keyOf(labels), value);
}

/** Latency buckets in seconds — web-request shaped, not job shaped. */
const DEFAULT_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export function observe(
  name: string,
  help: string,
  seconds: number,
  labels: Labels = {},
  buckets: number[] = DEFAULT_BUCKETS,
): void {
  const s = series(name, help, "histogram", buckets);
  const k = keyOf(labels);
  s.sums!.set(k, (s.sums!.get(k) ?? 0) + seconds);
  s.counts!.set(k, (s.counts!.get(k) ?? 0) + 1);
  for (const b of s.buckets!) {
    if (seconds <= b) {
      const bk = `${k}|le=${b}`;
      s.values.set(bk, (s.values.get(bk) ?? 0) + 1);
    }
  }
}

function labelString(key: string, extra?: string): string {
  const parts = key ? key.split(",").map((p) => {
    const i = p.indexOf("=");
    return `${p.slice(0, i)}="${p.slice(i + 1)}"`;
  }) : [];
  if (extra) parts.push(extra);
  return parts.length ? `{${parts.join(",")}}` : "";
}

export function render(): string {
  const out: string[] = [];
  for (const [name, s] of registry) {
    out.push(`# HELP ${name} ${s.help}`);
    out.push(`# TYPE ${name} ${s.type}`);
    if (s.type === "histogram") {
      for (const [k, count] of s.counts!) {
        let cumulative = 0;
        for (const b of s.buckets!) {
          cumulative = s.values.get(`${k}|le=${b}`) ?? cumulative;
          out.push(`${name}_bucket${labelString(k, `le="${b}"`)} ${cumulative}`);
        }
        out.push(`${name}_bucket${labelString(k, 'le="+Inf"')} ${count}`);
        out.push(`${name}_sum${labelString(k)} ${s.sums!.get(k) ?? 0}`);
        out.push(`${name}_count${labelString(k)} ${count}`);
      }
    } else {
      for (const [k, v] of s.values) out.push(`${name}${labelString(k)} ${v}`);
    }
  }
  return out.join("\n") + "\n";
}

/** Test seam — the registry is process-global, so suites must reset it. */
export function resetMetrics(): void {
  registry.clear();
}

/**
 * Event loop lag: the one process-level signal the cluster cannot see.
 * A saturated event loop looks healthy to the kubelet — CPU is fine,
 * memory is fine, the pod is up — while every request queues behind it.
 */
const LAG = Symbol.for("piotrr.metrics.lag");
export function trackEventLoopLag(intervalMs = 5000): void {
  const gl = globalThis as unknown as Record<symbol, boolean | undefined>;
  if (gl[LAG]) return;
  gl[LAG] = true;
  let last = process.hrtime.bigint();
  const timer = setInterval(() => {
    const now = process.hrtime.bigint();
    const drift = Number(now - last) / 1e6 - intervalMs;
    last = now;
    gauge(
      "app_event_loop_lag_seconds",
      "Delay beyond the scheduled interval; a saturated loop looks healthy to the kubelet",
      Math.max(0, drift) / 1000,
    );
  }, intervalMs);
  timer.unref(); // never hold the process open during shutdown
}
