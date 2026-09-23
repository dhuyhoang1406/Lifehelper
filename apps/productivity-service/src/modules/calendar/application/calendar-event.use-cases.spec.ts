import { ProductivityErrorCode } from "../../../application/errors/productivity.errors";
import type { CalendarEventRepository } from "../../../application/repositories/productivity.repositories";
import { CalendarEvent } from "../domain/entities/calendar-event.entity";
import { CalendarEventType } from "../domain/enums/calendar-event-type.enum";
import {
  CreateCalendarEvent,
  DeleteCalendarEvent,
  GetCalendarEvent,
  ListCalendarEvents,
  UpdateCalendarEvent,
} from "./calendar-event.use-cases";

describe("Calendar event use cases", () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const event = () =>
    CalendarEvent.create({
      id: "10000000-0000-4000-8000-000000000001",
      userId,
      title: "Planning",
      eventType: CalendarEventType.WORK,
      startAt: new Date("2026-09-16T01:00:00Z"),
      endAt: new Date("2026-09-16T02:00:00Z"),
      timezone: "Asia/Ho_Chi_Minh",
    });
  const repository = (found: CalendarEvent | null = event()) =>
    ({
      findByIdAndUserId: jest.fn().mockResolvedValue(found),
      findByUserAndRange: jest.fn().mockResolvedValue(found ? [found] : []),
      save: jest.fn().mockResolvedValue(undefined),
    }) as jest.Mocked<CalendarEventRepository>;

  it("creates an event for the authenticated owner", async () => {
    const repo = repository(null);
    const result = await new CreateCalendarEvent(repo).execute(userId, {
      title: "Planning",
      eventType: CalendarEventType.WORK,
      startAt: new Date("2026-09-16T08:00:00+07:00"),
      endAt: new Date("2026-09-16T09:00:00+07:00"),
      timezone: "Asia/Ho_Chi_Minh",
    });
    expect(result.userId).toBe(userId);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it("scopes get by owner and hides another user's event", async () => {
    const repo = repository(null);
    await expect(
      new GetCalendarEvent(repo).execute(userId, "event-id"),
    ).rejects.toMatchObject({
      code: ProductivityErrorCode.CALENDAR_EVENT_NOT_FOUND,
      statusCode: 404,
    });
    expect(repo.findByIdAndUserId).toHaveBeenCalledWith("event-id", userId);
  });

  it("passes a valid date range to the repository", async () => {
    const repo = repository();
    const from = new Date("2026-09-01T00:00:00Z");
    const to = new Date("2026-10-01T00:00:00Z");
    await new ListCalendarEvents(repo).execute(userId, from, to);
    expect(repo.findByUserAndRange).toHaveBeenCalledWith(
      userId,
      from,
      to,
      1,
      50,
    );
  });

  it("rejects incomplete and inverted list ranges", async () => {
    const list = new ListCalendarEvents(repository());
    await expect(
      list.execute(userId, new Date("2026-10-01T00:00:00Z")),
    ).rejects.toThrow("after start");
    await expect(
      list.execute(
        userId,
        new Date("2026-10-01T00:00:00Z"),
        new Date("2026-09-01T00:00:00Z"),
      ),
    ).rejects.toThrow("after start");
  });

  it("updates and soft-deletes owned events", async () => {
    const repo = repository();
    const updated = await new UpdateCalendarEvent(repo).execute(
      userId,
      event().state.id,
      { title: "Updated" },
    );
    expect(updated.title).toBe("Updated");
    await new DeleteCalendarEvent(repo).execute(userId, event().state.id);
    expect(repo.save).toHaveBeenCalledTimes(2);
    expect(repo.save.mock.calls[1][0].state.deletedAt).toBeInstanceOf(Date);
  });
});
