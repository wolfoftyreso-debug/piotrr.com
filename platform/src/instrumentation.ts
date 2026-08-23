/**
 * Next.js instrumentation hook — process-wide setup at boot.
 *
 * Three jobs: install signal handlers so the process can be stopped
 * without losing work, start the in-process pg-boss runner, and begin
 * sampling event-loop lag.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { installSignalHandlers, onShutdown } = await import("@/lib/lifecycle");
  const { logger } = await import("@/lib/logger");
  const { gauge, trackEventLoopLag } = await import("@/lib/metrics");

  installSignalHandlers();
  trackEventLoopLag();

  const { pool } = await import("@/lib/db");
  onShutdown("postgres pool", () => pool.end());

  if (process.env.ENABLE_JOBS !== "1") return;

  /**
   * The job runner must not be able to stop the server from booting.
   *
   * Measured: with the database briefly unreachable, `startJobs()` threw
   * out of this hook and Next refused to start at all — so a database
   * that is slow to come up during a cluster restart took the whole
   * application down with it, and the pod crash-looped instead of
   * waiting. §27 treats a slow dependency as normal, so this retries in
   * the background while the app serves. Readiness already fails while
   * the database is unreachable, so no traffic is misrouted meanwhile.
   */
  const startWithRetry = async () => {
    const { startJobs } = await import("@/jobs/start");
    for (let attempt = 1; ; attempt++) {
      try {
        const boss = await startJobs();
        onShutdown("pg-boss", () => boss.stop({ graceful: true, wait: true }));
        gauge("jobs_runner_up", "1 when the pg-boss runner is attached", 1);
        logger.info({ attempt }, "job runner started");
        return;
      } catch (error) {
        gauge("jobs_runner_up", "1 when the pg-boss runner is attached", 0);
        // Exponential backoff, capped: a retry storm against a database
        // that is already struggling helps nobody (§27).
        const waitMs = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
        logger.error(
          { err: error, attempt, retryInMs: waitMs },
          "job runner failed to start; the app keeps serving and will retry",
        );
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  };

  // Deliberately not awaited: booting must not block on a dependency.
  void startWithRetry();
}
