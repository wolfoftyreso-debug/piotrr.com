/**
 * Process lifecycle: shutdown state and ordered drain.
 *
 * Kubernetes sends SIGTERM and then waits `terminationGracePeriodSeconds`
 * before SIGKILL. Without a handler the process died instantly on every
 * rolling deploy — which meant any pg-boss job mid-flight (a malware
 * scan, an outbox dispatch, the nightly expiry sweep) was cut off partway
 * through, and in-flight HTTP requests were dropped. That is a data
 * integrity problem on the most routine operation there is: deploying.
 *
 * The order matters and is the reason this is a module rather than one
 * `process.on` call:
 *
 *   1. SIGTERM arrives. Mark the process as draining.
 *   2. `/api/readyz` starts failing, so the endpoints controller pulls
 *      this pod out of the Service. New requests stop arriving.
 *   3. Wait out the propagation delay — endpoint removal is eventually
 *      consistent across kube-proxy on every node, so exiting the moment
 *      readiness flips still drops requests.
 *   4. Run the registered drains (stop accepting jobs, finish the ones
 *      already running).
 *   5. Exit.
 *
 * Liveness must NOT consult this state: a draining pod is deliberately
 * not ready, and restarting it would defeat the drain.
 */
import { logger } from "@/lib/logger";

type Drain = { name: string; run: () => Promise<void> };

/**
 * Process-wide, not module-wide.
 *
 * Next bundles the instrumentation hook and the route handlers into
 * separate chunks, so a module-level `let` is not one variable — the
 * signal handler set it in its own copy and the readiness route read a
 * different copy that was still `false`. Measured: after SIGTERM the
 * drain ran correctly and /api/readyz kept answering 200, which is the
 * exact failure this whole mechanism exists to prevent. globalThis is
 * the one namespace both chunks genuinely share.
 */
const STATE = Symbol.for("piotrr.lifecycle");
type State = { draining: boolean; drains: Drain[]; installed: boolean };
const g = globalThis as unknown as Record<symbol, State | undefined>;
const state: State = (g[STATE] ??= { draining: false, drains: [], installed: false });
const drains = state.drains;

/** True once SIGTERM has been seen. Read by the readiness probe. */
export function isDraining(): boolean {
  return state.draining;
}

/**
 * Register work to finish before the process exits. Called at boot, so
 * ordering follows registration order.
 */
export function onShutdown(name: string, run: () => Promise<void>): void {
  drains.push({ name, run });
}

/**
 * How long to keep serving after readiness flips, so kube-proxy on every
 * node has removed this pod from the Service. Must stay comfortably below
 * terminationGracePeriodSeconds or the drain gets SIGKILLed mid-way.
 */
const DRAIN_DELAY_MS = Number(process.env.SHUTDOWN_DRAIN_DELAY_MS ?? 5000);
const DRAIN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 20000);

async function shutdown(signal: string): Promise<void> {
  if (state.draining) return; // a second SIGTERM must not start a second drain
  state.draining = true;
  logger.info({ signal }, "shutdown started; readiness is now failing");

  await new Promise((r) => setTimeout(r, DRAIN_DELAY_MS));

  for (const { name, run } of drains) {
    try {
      await Promise.race([
        run(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("drain timed out")), DRAIN_TIMEOUT_MS),
        ),
      ]);
      logger.info({ drain: name }, "drain complete");
    } catch (error) {
      // A drain that hangs must not hold the pod past its grace period;
      // SIGKILL would be a worse ending than a logged failure.
      logger.error({ err: error, drain: name }, "drain failed; continuing shutdown");
    }
  }

  logger.info("shutdown complete");
  process.exit(0);
}

/** Idempotent: the instrumentation hook can run more than once. */
export function installSignalHandlers(): void {
  if (state.installed) return;
  state.installed = true;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}
