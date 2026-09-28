DROP INDEX "messages_conversation_id_created_at_idx";
CREATE INDEX "messages_conversation_id_created_at_id_idx"
  ON "messages"("conversation_id", "created_at", "id");
