ALTER TABLE "tags" ADD COLUMN "normalized_name" VARCHAR(80);
UPDATE "tags" SET "normalized_name" = LOWER(TRIM("name"));
ALTER TABLE "tags" ALTER COLUMN "normalized_name" SET NOT NULL;
DROP INDEX IF EXISTS "tags_user_id_name_key";
CREATE UNIQUE INDEX "tags_user_id_normalized_name_key" ON "tags"("user_id", "normalized_name");
