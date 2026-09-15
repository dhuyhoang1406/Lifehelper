ALTER TABLE "tags" ADD COLUMN "normalized_name" VARCHAR(80);

-- Preserve every task association while merging legacy tags whose names only
-- differ by case or surrounding whitespace. The oldest tag becomes canonical.
CREATE TEMP TABLE "_tag_deduplication" ON COMMIT DROP AS
SELECT "duplicate_id", "canonical_id"
FROM (
  SELECT
    "id" AS "duplicate_id",
    FIRST_VALUE("id") OVER (
      PARTITION BY "user_id", LOWER(TRIM("name"))
      ORDER BY "created_at", "id"
    ) AS "canonical_id"
  FROM "tags"
) AS "ranked_tags"
WHERE "duplicate_id" <> "canonical_id";

INSERT INTO "task_tags" ("task_id", "tag_id")
SELECT "task_tags"."task_id", "_tag_deduplication"."canonical_id"
FROM "task_tags"
JOIN "_tag_deduplication"
  ON "_tag_deduplication"."duplicate_id" = "task_tags"."tag_id"
ON CONFLICT ("task_id", "tag_id") DO NOTHING;

DELETE FROM "task_tags"
USING "_tag_deduplication"
WHERE "task_tags"."tag_id" = "_tag_deduplication"."duplicate_id";

DELETE FROM "tags"
USING "_tag_deduplication"
WHERE "tags"."id" = "_tag_deduplication"."duplicate_id";

UPDATE "tags" SET "normalized_name" = LOWER(TRIM("name"));
ALTER TABLE "tags" ALTER COLUMN "normalized_name" SET NOT NULL;
DROP INDEX IF EXISTS "tags_user_id_name_key";
CREATE UNIQUE INDEX "tags_user_id_normalized_name_key" ON "tags"("user_id", "normalized_name");
