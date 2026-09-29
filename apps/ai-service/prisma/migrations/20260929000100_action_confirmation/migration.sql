ALTER TYPE "AIActionStatus" ADD VALUE 'EXECUTING';
ALTER TABLE "ai_action_logs"
  ADD COLUMN "payload_hash" VARCHAR(64),
  ADD COLUMN "idempotency_key" UUID,
  ADD COLUMN "expires_at" TIMESTAMPTZ(6);
CREATE UNIQUE INDEX "ai_action_logs_idempotency_key_key" ON "ai_action_logs"("idempotency_key");
CREATE INDEX "ai_action_logs_user_id_status_expires_at_idx" ON "ai_action_logs"("user_id", "status", "expires_at");
