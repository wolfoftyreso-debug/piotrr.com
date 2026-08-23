/**
 * Load test against a running production build.
 *
 *   BASE=http://127.0.0.1:3100 node scripts/load-test.mjs
 *
 * Not a benchmark of the machine — a measurement of the system's shape
 * under concurrency: does latency degrade linearly or fall off a cliff,
 * does the database-backed path behave like the prerendered one, does
 * the event loop stay responsive. Loopback numbers flatter absolute
 * latency (no network) and punish throughput (client and server share
 * the CPU); the *ratios* between paths are what carry meaning.
 *
 * Method: fixed concurrency, closed loop (each worker fires its next
 * request when the previous answers), fixed wall-clock duration per
 * target, cold-start excluded by a warmup pass. Percentiles from the
 * full sample, not a reservoir.
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 40);
const DURATION_MS = Number(process.env.LOAD_DURATION_MS ?? 12_000);

const TARGETS = [
  { name: "home (prerendered)", path: "/sv" },
  { name: "directory (SSR + DB)", path: "/sv/suppliers" },
  { name: "API suppliers (DB)", path: "/api/v1/suppliers?limit=30" },
  { name: "API catalog (DB)", path: "/api/v1/catalog" },
];

function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function metricValue(name) {
  try {
    const res = await fetch(`${BASE}/api/metrics`, {
      headers: { authorization: "Bearer probe-token" },
    });
    if (!res.ok) return null;
    const line = (await res.text()).split("\n").find((l) => l.startsWith(name + " "));
    return line ? Number(line.split(" ")[1]) : null;
  } catch {
    return null;
  }
}

async function run(target) {
  // Warmup: fill caches, JIT, pool connections — not part of the sample.
  for (let i = 0; i < 10; i++) await fetch(`${BASE}${target.path}`);

  const latencies = [];
  let errors = 0;
  const deadline = Date.now() + DURATION_MS;

  async function worker() {
    while (Date.now() < deadline) {
      const t0 = performance.now();
      try {
        const res = await fetch(`${BASE}${target.path}`);
        await res.arrayBuffer(); // drain — a closed loop must finish reads
        if (!res.ok) errors++;
        else latencies.push(performance.now() - t0);
      } catch {
        errors++;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  latencies.sort((a, b) => a - b);
  const seconds = DURATION_MS / 1000;
  return {
    name: target.name,
    requests: latencies.length,
    rps: latencies.length / seconds,
    p50: pct(latencies, 50),
    p95: pct(latencies, 95),
    p99: pct(latencies, 99),
    max: latencies[latencies.length - 1] ?? 0,
    errors,
  };
}

const lagBefore = await metricValue("app_event_loop_lag_seconds");
console.log(`load test: concurrency=${CONCURRENCY}, ${DURATION_MS / 1000}s per target, base=${BASE}\n`);
console.log(
  "target".padEnd(24) + "req".padStart(7) + "rps".padStart(8) +
  "p50ms".padStart(8) + "p95ms".padStart(8) + "p99ms".padStart(8) +
  "maxms".padStart(8) + "err".padStart(5),
);

let anyErrors = false;
for (const target of TARGETS) {
  const r = await run(target);
  anyErrors = anyErrors || r.errors > 0;
  console.log(
    r.name.padEnd(24) + String(r.requests).padStart(7) +
    r.rps.toFixed(0).padStart(8) + r.p50.toFixed(1).padStart(8) +
    r.p95.toFixed(1).padStart(8) + r.p99.toFixed(1).padStart(8) +
    r.max.toFixed(0).padStart(8) + String(r.errors).padStart(5),
  );
}

const lagAfter = await metricValue("app_event_loop_lag_seconds");
console.log(`\nevent-loop lag: before=${lagBefore ?? "n/a"}s after=${lagAfter ?? "n/a"}s`);
if (anyErrors) {
  console.log("LOAD TEST: errors occurred");
  process.exit(1);
}
console.log("LOAD TEST: no errors");
