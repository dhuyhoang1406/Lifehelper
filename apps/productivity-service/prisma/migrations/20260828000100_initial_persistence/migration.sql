-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "CalendarEventType" AS ENUM ('PERSONAL', 'WORK', 'STUDY', 'INTERVIEW', 'MEETING', 'OTHER');

-- CreateEnum
CREATE TYPE "HabitFrequency" AS ENUM ('DAILY', 'WEEKLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReminderResourceType" AS ENUM ('TASK', 'CALENDAR_EVENT', 'HABIT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'QUEUED', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL,
    "priority" "TaskPriority" NOT NULL,
    "due_at" TIMESTAMPTZ(6),
    "estimated_minutes" INTEGER,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subtasks" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subtasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_tags" (
    "task_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "task_tags_pkey" PRIMARY KEY ("task_id","tag_id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "event_type" "CalendarEventType" NOT NULL,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "location" VARCHAR(255),
    "recurrence_rule" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "habits" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "frequency_type" "HabitFrequency" NOT NULL,
    "target_count" INTEGER NOT NULL DEFAULT 1,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "habits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "habit_schedules" (
    "id" UUID NOT NULL,
    "habit_id" UUID NOT NULL,
    "day_of_week" SMALLINT,
    "time_of_day" TIME(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "habit_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "habit_logs" (
    "id" UUID NOT NULL,
    "habit_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "log_date" DATE NOT NULL,
    "completed_count" INTEGER NOT NULL DEFAULT 1,
    "completed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "habit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "resource_type" "ReminderResourceType" NOT NULL,
    "resource_id" UUID,
    "title" VARCHAR(255) NOT NULL,
    "remind_at" TIMESTAMPTZ(6) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "status" "ReminderStatus" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "cancelled_at" TIMESTAMPTZ(6),

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "tasks_user_id_status_idx" ON "tasks"("user_id", "status");

-- CreateIndex
CREATE INDEX "tasks_user_id_due_at_idx" ON "tasks"("user_id", "due_at");

-- CreateIndex
CREATE INDEX "subtasks_task_id_position_idx" ON "subtasks"("task_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "tags_user_id_name_key" ON "tags"("user_id", "name");

-- CreateIndex
CREATE INDEX "task_tags_tag_id_idx" ON "task_tags"("tag_id");

-- CreateIndex
CREATE INDEX "calendar_events_user_id_start_at_idx" ON "calendar_events"("user_id", "start_at");

-- CreateIndex
CREATE INDEX "habits_user_id_is_active_idx" ON "habits"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "habit_schedules_habit_id_idx" ON "habit_schedules"("habit_id");

-- CreateIndex
CREATE INDEX "habit_logs_user_id_log_date_idx" ON "habit_logs"("user_id", "log_date");

-- CreateIndex
CREATE UNIQUE INDEX "habit_logs_habit_id_log_date_key" ON "habit_logs"("habit_id", "log_date");

-- CreateIndex
CREATE INDEX "reminders_user_id_status_remind_at_idx" ON "reminders"("user_id", "status", "remind_at");

-- CreateIndex
CREATE INDEX "reminders_resource_type_resource_id_idx" ON "reminders"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "outbox_events_processed_at_occurred_at_idx" ON "outbox_events"("processed_at", "occurred_at");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_idx" ON "outbox_events"("aggregate_type", "aggregate_id");

-- AddForeignKey
ALTER TABLE "subtasks" ADD CONSTRAINT "subtasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habit_schedules" ADD CONSTRAINT "habit_schedules_habit_id_fkey" FOREIGN KEY ("habit_id") REFERENCES "habits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habit_logs" ADD CONSTRAINT "habit_logs_habit_id_fkey" FOREIGN KEY ("habit_id") REFERENCES "habits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_estimated_minutes_check" CHECK ("estimated_minutes" IS NULL OR "estimated_minutes" > 0);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_state_check" CHECK (("status" = 'COMPLETED' AND "completed_at" IS NOT NULL) OR ("status" <> 'COMPLETED' AND "completed_at" IS NULL));
ALTER TABLE "subtasks" ADD CONSTRAINT "subtasks_position_check" CHECK ("position" >= 0);
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_range_check" CHECK ("end_at" > "start_at");
ALTER TABLE "habits" ADD CONSTRAINT "habits_target_count_check" CHECK ("target_count" >= 1);
ALTER TABLE "habits" ADD CONSTRAINT "habits_date_range_check" CHECK ("end_date" IS NULL OR "end_date" >= "start_date");
ALTER TABLE "habit_schedules" ADD CONSTRAINT "habit_schedules_day_of_week_check" CHECK ("day_of_week" IS NULL OR "day_of_week" BETWEEN 1 AND 7);
ALTER TABLE "habit_logs" ADD CONSTRAINT "habit_logs_completed_count_check" CHECK ("completed_count" >= 1);
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_resource_check" CHECK ("resource_type" = 'CUSTOM' OR "resource_id" IS NOT NULL);
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_attempt_count_check" CHECK ("attempt_count" >= 0);
