import { PrismaService } from "../src/prisma.service";
import {
  PrismaCalendarEventRepository,
  PrismaHabitLogRepository,
  PrismaHabitRepository,
  PrismaReminderRepository,
  PrismaTaskRepository,
} from "../src/persistence/productivity.repositories";
import { Task } from "../src/modules/task/domain/entities/task.entity";
import { CalendarEvent } from "../src/modules/calendar/domain/entities/calendar-event.entity";
import { CalendarEventType } from "../src/modules/calendar/domain/enums/calendar-event-type.enum";
import { Habit } from "../src/modules/habit/domain/entities/habit.entity";
import { HabitLog } from "../src/modules/habit/domain/entities/habit-log.entity";
import { HabitSchedule } from "../src/modules/habit/domain/entities/habit-schedule.entity";
import { HabitFrequency } from "../src/modules/habit/domain/enums/habit-frequency.enum";
import { Reminder } from "../src/modules/reminder/domain/entities/reminder.entity";
import { ReminderResourceType } from "../src/modules/reminder/domain/enums/reminder.enums";
import {
  PrismaTransactionRunner,
  writeOutbox,
} from "../src/persistence/transaction/prisma-transaction";
const db = new PrismaService();
const id = "10000000-0000-4000-8000-000000000002";
const calendarId = "20000000-0000-4000-8000-000000000002";
const habitId = "30000000-0000-4000-8000-000000000002";
const habitLogId = "40000000-0000-4000-8000-000000000002";
const reminderId = "60000000-0000-4000-8000-000000000002";
describe("Productivity persistence", () => {
  const repo = new PrismaTaskRepository(db);
  beforeAll(() => db.$connect());
  afterAll(async () => {
    await db.outboxEvent.deleteMany({ where: { aggregateId: id } });
    await db.calendarEvent.deleteMany({ where: { id: calendarId } });
    await db.habit.deleteMany({ where: { id: habitId } });
    await db.reminder.deleteMany({ where: { id: reminderId } });
    await db.task.deleteMany({ where: { id } });
    await db.$disconnect();
  });
  it("saves and restores Task", async () => {
    await repo.save(
      Task.create({
        id,
        userId: "00000000-0000-4000-8000-000000000001",
        title: "Integration",
      }),
    );
    expect(
      (await repo.findByIdAndUserId(id, "00000000-0000-4000-8000-000000000001"))
        ?.state.title,
    ).toBe("Integration");
  });
  it("rolls back business data and outbox atomically", async () => {
    const rollbackId = "10000000-0000-4000-8000-000000000099";
    await expect(
      new PrismaTransactionRunner(db).run(async (tx) => {
        await tx.task.create({
          data: {
            id: rollbackId,
            userId: "00000000-0000-4000-8000-000000000001",
            title: "Rollback",
            status: "TODO",
            priority: "MEDIUM",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
        await writeOutbox(tx, {
          id: rollbackId,
          eventType: "task.created",
          aggregateType: "Task",
          aggregateId: rollbackId,
          payload: {},
          occurredAt: new Date(),
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await db.task.findUnique({ where: { id: rollbackId } })).toBeNull();
    expect(
      await db.outboxEvent.findUnique({ where: { id: rollbackId } }),
    ).toBeNull();
  });
  it("persists CalendarEvent timezone and queries overlapping ranges", async () => {
    const events = new PrismaCalendarEventRepository(db);
    await events.save(
      CalendarEvent.create({
        id: calendarId,
        userId: "00000000-0000-4000-8000-000000000001",
        title: "Cross-boundary event",
        eventType: CalendarEventType.MEETING,
        startAt: new Date("2026-09-15T23:00:00Z"),
        endAt: new Date("2026-09-16T01:00:00Z"),
        timezone: "Asia/Ho_Chi_Minh",
      }),
    );
    const result = await events.findByUserAndRange(
      "00000000-0000-4000-8000-000000000001",
      new Date("2026-09-16T00:00:00Z"),
      new Date("2026-09-17T00:00:00Z"),
    );
    expect(result).toHaveLength(1);
    expect(result[0].state.startAt.toISOString()).toBe(
      "2026-09-15T23:00:00.000Z",
    );
    expect(result[0].state.timezone).toBe("Asia/Ho_Chi_Minh");
  });
  it("persists a Habit aggregate and enforces one log per date", async () => {
    const habits = new PrismaHabitRepository(db);
    const logs = new PrismaHabitLogRepository(db);
    const habit = Habit.create({
      id: habitId,
      userId: "00000000-0000-4000-8000-000000000001",
      name: "Integration habit",
      frequencyType: HabitFrequency.WEEKLY,
      timezone: "Asia/Ho_Chi_Minh",
      startDate: "2026-09-01",
    });
    const schedule = HabitSchedule.create({
      id: "50000000-0000-4000-8000-000000000002",
      habitId,
      dayOfWeek: 2,
      timeOfDay: "07:30:00",
    });
    await habits.save(habit, [schedule]);
    const restored = await habits.findByIdAndUserId(
      habitId,
      "00000000-0000-4000-8000-000000000001",
    );
    expect(restored?.habit.state.timezone).toBe("Asia/Ho_Chi_Minh");
    expect(restored?.schedules[0].state.timeOfDay).toBe("07:30:00");

    await logs.save(
      HabitLog.create({
        id: habitLogId,
        habitId,
        userId: "00000000-0000-4000-8000-000000000001",
        logDate: "2026-09-16",
      }),
    );
    await expect(
      logs.save(
        HabitLog.create({
          id: "40000000-0000-4000-8000-000000000003",
          habitId,
          userId: "00000000-0000-4000-8000-000000000001",
          logDate: "2026-09-16",
        }),
      ),
    ).rejects.toThrow("already logged");
  });
  it("persists a reminder with UTC instant, timezone, and owner-scoped lookup", async () => {
    const reminders = new PrismaReminderRepository(db);
    const userId = "00000000-0000-4000-8000-000000000001";
    await reminders.save(
      Reminder.create({
        id: reminderId,
        userId,
        resourceType: ReminderResourceType.TASK,
        resourceId: id,
        title: "Task due",
        remindAt: new Date("2026-09-22T09:00:00+07:00"),
        timezone: "Asia/Ho_Chi_Minh",
      }),
    );
    expect(await reminders.resourceBelongsToUser("TASK", id, userId)).toBe(
      true,
    );
    expect(
      await reminders.findByIdAndUserId(
        reminderId,
        "00000000-0000-4000-8000-000000000099",
      ),
    ).toBeNull();
    const restored = await reminders.findByIdAndUserId(reminderId, userId);
    expect(restored?.state.remindAt.toISOString()).toBe(
      "2026-09-22T02:00:00.000Z",
    );
    expect(restored?.state.timezone).toBe("Asia/Ho_Chi_Minh");
    expect(
      (
        await reminders.findPageByUserId(userId, { page: 1, limit: 20 })
      ).items.some(({ state }) => state.id === reminderId),
    ).toBe(true);
  });
});
