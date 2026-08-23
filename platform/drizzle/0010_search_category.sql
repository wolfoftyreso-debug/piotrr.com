-- Category was not part of the search vector, so the public trade chips
-- ("Carpentry", "Roofing", …) only matched when the word happened to appear
-- in a company's free-text description. Rebuild the generated column with
-- category included so trade navigation resolves reliably.
DROP INDEX IF EXISTS "idx_companies_search_tsv";--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "search_tsv";--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "search_tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce("name", '') || ' ' ||
      coalesce("description", '') || ' ' ||
      coalesce("city", '') || ' ' ||
      coalesce("category", '')
    )
  ) STORED;--> statement-breakpoint
CREATE INDEX "idx_companies_search_tsv" ON "companies" USING gin ("search_tsv");
