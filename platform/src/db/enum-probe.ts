/**
 * Child probe for failure-test case 6.
 *
 * The email provider is chosen from the environment parsed at process
 * start, so "the relay is down" is a property a process is BORN with —
 * it cannot be arranged by mutating process.env afterwards. The first
 * version of that case tried exactly that and tested nothing. This
 * probe exists to be spawned with a dead-relay environment
 * (EMAIL_PROVIDER=smtp, SMTP_HOST=127.0.0.1, SMTP_PORT=1) and reports
 * one line: whether each requested address resolved or threw. Both must
 * resolve — a difference is the account-enumeration oracle of security
 * report §15b.
 */
import { requestMagicLink } from "@/modules/identity/magic-link";
import { pool } from "@/lib/db";

async function main() {
  const outcomes: string[] = [];
  for (const email of process.argv.slice(2)) {
    try {
      await requestMagicLink(email, "https://example.test", "sv");
      outcomes.push("resolved");
    } catch {
      outcomes.push("threw");
    }
  }
  console.log("ENUM-PROBE " + outcomes.join(" "));
  await pool.end();
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
