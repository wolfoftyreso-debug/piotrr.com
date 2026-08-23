import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";

import * as identity from "@/modules/identity/schema";
import * as catalog from "@/modules/catalog/schema";
import * as companies from "@/modules/companies/schema";
import * as documents from "@/modules/documents/schema";
import * as verification from "@/modules/verification/schema";
import * as audit from "@/modules/audit/schema";
import * as notifications from "@/modules/notifications/schema";
import * as rfq from "@/modules/rfq/schema";
import * as offersModule from "@/modules/offers/schema";
import * as messaging from "@/modules/messaging/schema";
import * as reputation from "@/modules/reputation/schema";
import * as agreementsModule from "@/modules/agreements/schema";

export const schema = {
  ...identity,
  ...catalog,
  ...companies,
  ...documents,
  ...verification,
  ...audit,
  ...notifications,
  ...rfq,
  ...offersModule,
  ...messaging,
  ...reputation,
  ...agreementsModule,
};

const globalForDb = globalThis as unknown as { pgPool?: Pool };

export const pool =
  globalForDb.pgPool ?? new Pool({ connectionString: env.DATABASE_URL });
if (process.env.NODE_ENV !== "production") globalForDb.pgPool = pool;

export const db = drizzle(pool, { schema });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
