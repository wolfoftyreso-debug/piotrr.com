import pino from "pino";

/** pino → stdout → CloudWatch Logs (Section 3) */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "piotrr" },
});
