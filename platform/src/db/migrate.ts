import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "@/lib/db";
import { logger } from "@/lib/logger";

async function main() {
  await migrate(db, { migrationsFolder: "./drizzle" });
  logger.info("migrations applied");
  await pool.end();
}

main().catch((error) => {
  logger.error(error, "migration failed");
  process.exit(1);
});
