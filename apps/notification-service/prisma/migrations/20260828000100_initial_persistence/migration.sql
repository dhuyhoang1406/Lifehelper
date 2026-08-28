-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('REMINDER', 'TASK', 'CALENDAR', 'HABIT', 'AI', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "NotificationProvider" AS ENUM ('FCM');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "source_event_id" UUID,
    "status" "NotificationStatus" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "device_session_id" UUID NOT NULL,
    "provider" "NotificationProvider" NOT NULL,
    "provider_message_id" VARCHAR(255),
    "status" "DeliveryStatus" NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_status_created_at_idx" ON "notifications"("status", "created_at");

-- CreateIndex
CREATE INDEX "notifications_source_event_id_idx" ON "notifications"("source_event_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_updated_at_idx" ON "notification_deliveries"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notification_id_device_session_id_key" ON "notification_deliveries"("notification_id", "device_session_id");

-- CreateIndex
CREATE INDEX "outbox_events_processed_at_occurred_at_idx" ON "outbox_events"("processed_at", "occurred_at");

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_attempt_count_check" CHECK ("attempt_count" >= 0);
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_attempt_count_check" CHECK ("attempt_count" >= 0);
