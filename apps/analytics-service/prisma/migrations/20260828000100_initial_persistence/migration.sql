-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "daily_productivity_metrics" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "metric_date" DATE NOT NULL,
    "tasks_created" INTEGER NOT NULL DEFAULT 0,
    "tasks_completed" INTEGER NOT NULL DEFAULT 0,
    "habit_checkins" INTEGER NOT NULL DEFAULT 0,
    "calendar_events" INTEGER NOT NULL DEFAULT 0,
    "ai_requests" INTEGER NOT NULL DEFAULT 0,
    "ai_tool_actions" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "daily_productivity_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_processing_logs" (
    "event_id" UUID NOT NULL,
    "event_type" VARCHAR(120) NOT NULL,
    "consumer" VARCHAR(120) NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "event_processing_logs_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(120) NOT NULL,
    "aggregate_type" VARCHAR(120) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "processed_at" TIMESTAMPTZ(6),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_productivity_metrics_user_id_metric_date_idx" ON "daily_productivity_metrics"("user_id", "metric_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_productivity_metrics_user_id_metric_date_key" ON "daily_productivity_metrics"("user_id", "metric_date");

-- CreateIndex
CREATE INDEX "event_processing_logs_consumer_processed_at_idx" ON "event_processing_logs"("consumer", "processed_at");

-- CreateIndex
CREATE INDEX "outbox_events_processed_at_occurred_at_idx" ON "outbox_events"("processed_at", "occurred_at");

ALTER TABLE "daily_productivity_metrics" ADD CONSTRAINT "daily_productivity_metrics_counters_check" CHECK ("tasks_created" >= 0 AND "tasks_completed" >= 0 AND "habit_checkins" >= 0 AND "calendar_events" >= 0 AND "ai_requests" >= 0 AND "ai_tool_actions" >= 0);
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_attempt_count_check" CHECK ("attempt_count" >= 0);
