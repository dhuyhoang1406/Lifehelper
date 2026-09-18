ALTER TABLE "habits" ADD COLUMN "timezone" VARCHAR(64);

-- UTC is used only to backfill legacy rows; new habits must supply an explicit
-- IANA timezone through the API.
UPDATE "habits" SET "timezone" = 'UTC' WHERE "timezone" IS NULL;
ALTER TABLE "habits" ALTER COLUMN "timezone" SET NOT NULL;
