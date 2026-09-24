-- Persist trusted provider metadata alongside the provider model identifier.
ALTER TABLE "messages" ADD COLUMN "provider" VARCHAR(100);

-- Audit queries page by conversation in reverse chronological order.
DROP INDEX "ai_action_logs_conversation_id_idx";
CREATE INDEX "ai_action_logs_conversation_id_created_at_idx"
ON "ai_action_logs"("conversation_id", "created_at");
