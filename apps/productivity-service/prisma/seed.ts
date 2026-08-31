import { DEMO_IDS } from "@lifehelper/shared-types";
import {
  PrismaClient,
  TaskStatus,
  TaskPriority,
  CalendarEventType,
  HabitFrequency,
  ReminderResourceType,
  ReminderStatus,
} from "../generated/client";
const db = new PrismaClient();
async function main() {
  const now = new Date("2026-01-01T00:00:00Z");
  await db.task.upsert({
    where: { id: DEMO_IDS.task },
    update: {},
    create: {
      id: DEMO_IDS.task,
      userId: DEMO_IDS.user,
      title: "Demo task",
      status: TaskStatus.TODO,
      priority: TaskPriority.MEDIUM,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.calendarEvent.upsert({
    where: { id: DEMO_IDS.calendarEvent },
    update: {},
    create: {
      id: DEMO_IDS.calendarEvent,
      userId: DEMO_IDS.user,
      title: "Demo event",
      eventType: CalendarEventType.PERSONAL,
      startAt: now,
      endAt: new Date("2026-01-01T01:00:00Z"),
      timezone: "UTC",
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.habit.upsert({
    where: { id: DEMO_IDS.habit },
    update: {},
    create: {
      id: DEMO_IDS.habit,
      userId: DEMO_IDS.user,
      name: "Demo habit",
      frequencyType: HabitFrequency.DAILY,
      startDate: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.reminder.upsert({
    where: { id: DEMO_IDS.reminder },
    update: {},
    create: {
      id: DEMO_IDS.reminder,
      userId: DEMO_IDS.user,
      resourceType: ReminderResourceType.TASK,
      resourceId: DEMO_IDS.task,
      title: "Demo reminder",
      remindAt: now,
      timezone: "UTC",
      status: ReminderStatus.PENDING,
      createdAt: now,
      updatedAt: now,
    },
  });
}
main().finally(() => db.$disconnect());
