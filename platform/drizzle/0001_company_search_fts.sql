-- Search per Section 3: Postgres full-text (tsvector) + trigram. No OpenSearch.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "search_tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce("name", '') || ' ' ||
      coalesce("description", '') || ' ' ||
      coalesce("city", '')
    )
  ) STORED;
--> statement-breakpoint
CREATE INDEX "idx_companies_search_tsv" ON "companies" USING gin ("search_tsv");
--> statement-breakpoint
CREATE INDEX "idx_companies_name_trgm" ON "companies" USING gin ("name" gin_trgm_ops);
