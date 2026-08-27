import { CalendarEvent } from "./calendar-event.entity";
import { CalendarEventType } from "../enums/calendar-event-type.enum";
describe("CalendarEvent", () => {
  const input = {
    id: "event-id",
    userId: "user-id",
    title: "Meeting",
    eventType: CalendarEventType.MEETING,
    startAt: new Date("2026-01-01T10:00:00Z"),
    endAt: new Date("2026-01-01T11:00:00Z"),
    timezone: "Asia/Ho_Chi_Minh",
  };
  it("creates a valid range", () =>
    expect(CalendarEvent.create(input).state.endAt).toEqual(input.endAt));
  it("rejects an inverted range", () =>
    expect(() =>
      CalendarEvent.create({ ...input, endAt: input.startAt }),
    ).toThrow("after start"));
});
