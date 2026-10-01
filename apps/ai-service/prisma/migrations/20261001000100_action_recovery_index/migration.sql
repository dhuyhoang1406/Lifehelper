-- Recovery scans expired actions across all users.
CREATE INDEX "ai_action_logs_status_expires_at_idx" ON "ai_action_logs"("status", "expires_at");
