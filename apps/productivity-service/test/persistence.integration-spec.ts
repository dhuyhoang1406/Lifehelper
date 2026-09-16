import { PrismaService } from "../src/prisma.service";
import {
  PrismaCalendarEventRepository,
  PrismaTaskRepository,
} from "../src/persistence/productivity.repositories";
import { Task } from "../src/modules/task/domain/entities/task.entity";
import { CalendarEvent } from "../src/modules/calendar/domain/entities/calendar-event.entity";
import { CalendarEventType } from "../src/modules/calendar/domain/enums/calendar-event-type.enum";
import {
  PrismaTransactionRunner,
  writeOutbox,
} from "../src/persistence/transaction/prisma-transaction";
const db = new PrismaService();
const id = "10000000-0000-4000-8000-000000000002";
const calendarId = "20000000-0000-4000-8000-000000000002";
describe("Productivity persistence", () => {
  const repo = new PrismaTaskRepository(db);
  beforeAll(() => db.$connect());
  afterAll(async () => {
    await db.outboxEvent.deleteMany({ where: { aggregateId: id } });
    await db.calendarEvent.deleteMany({ where: { id: calendarId } });
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
      (
        await repo.findByIdAndUserId(
          id,
          "00000000-0000-4000-8000-000000000001",
        )
      )?.state.title,
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
});
