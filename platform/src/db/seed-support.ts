import { randomBytes } from "node:crypto";

/**
 * The password the seed gives the two staff accounts (admin@…, ops@…).
 *
 * This used to be the constant "change-me-now" — which is printed in the
 * README, docs/SANDBOX.md and docs/HANDOFF.md, i.e. published. The k8s
 * first-boot instructions run this same seed against the production
 * database, so following the documentation to the letter created a
 * production admin account with a published password, protected by
 * nothing but a sentence saying "change immediately". A sentence is not
 * an enforcement layer.
 *
 * The environment guard in env.ts cannot catch it either: the seed Job
 * gets its env from the deployment Secret, which does not set NODE_ENV,
 * so "am I in production?" is unanswerable exactly where it matters.
 *
 * So the default is inverted instead of detected: with no explicit
 * choice, every seed run generates a fresh random password and prints it
 * once, and the operator reads it from the job output. Development and
 * e2e — the only places a *known* password is a feature — opt in
 * explicitly with SEED_STAFF_PASSWORD, and that opt-in is visible in the
 * command line that made it.
 */
export function chooseStaffSeedPassword(explicit: string | undefined): {
  password: string;
  generated: boolean;
} {
  if (explicit !== undefined && explicit !== "") {
    if (explicit.length < 10) {
      // Same floor as self-serve registration; a weaker staff password
      // would be strange.
      throw new Error("SEED_STAFF_PASSWORD must be at least 10 characters");
    }
    return { password: explicit, generated: false };
  }
  return { password: randomBytes(18).toString("base64url"), generated: true };
}
