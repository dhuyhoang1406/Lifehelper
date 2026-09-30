ALTER TABLE "ai_action_logs"
  ADD COLUMN "provider" VARCHAR(100),
  ADD COLUMN "model" VARCHAR(100),
  ADD COLUMN "input_tokens" INTEGER,
  ADD COLUMN "output_tokens" INTEGER;

ALTER TABLE "ai_action_logs" ADD CONSTRAINT "ai_action_logs_token_counts_check"
  CHECK (("input_tokens" IS NULL OR "input_tokens" >= 0)
    AND ("output_tokens" IS NULL OR "output_tokens" >= 0));
