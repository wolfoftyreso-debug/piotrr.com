-- Dedupe first: keep the oldest definition per (corridor, key); re-point
-- any verification_items that referenced a duplicate before deleting it.
UPDATE "verification_items" vi
SET "requirement_definition_id" = keep.id
FROM "requirement_definitions" dup
JOIN LATERAL (
  SELECT id FROM "requirement_definitions" k
  WHERE k."corridor_id" = dup."corridor_id" AND k."key" = dup."key"
  ORDER BY k."created_at" ASC, k.id ASC LIMIT 1
) keep ON true
WHERE vi."requirement_definition_id" = dup.id AND dup.id <> keep.id;--> statement-breakpoint
DELETE FROM "requirement_definitions" dup
USING "requirement_definitions" keep
WHERE dup."corridor_id" = keep."corridor_id"
  AND dup."key" = keep."key"
  AND (keep."created_at" < dup."created_at"
       OR (keep."created_at" = dup."created_at" AND keep.id < dup.id));--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_definitions_corridor_key_unique" ON "requirement_definitions" USING btree ("corridor_id","key");