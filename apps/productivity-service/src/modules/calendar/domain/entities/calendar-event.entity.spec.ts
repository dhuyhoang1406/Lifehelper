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
  it("rejects an invalid IANA timezone", () =>
    expect(() =>
      CalendarEvent.create({ ...input, timezone: "Not/A_Timezone" }),
    ).toThrow("Invalid IANA timezone"));
  it("rejects an unsupported event type in the domain", () =>
    expect(() =>
      CalendarEvent.create({
        ...input,
        eventType: "HOLIDAY" as CalendarEventType,
      }),
    ).toThrow("Invalid calendar event type"));
  it("preserves the timezone while storing UTC instants", () => {
    const event = CalendarEvent.create({
      ...input,
      startAt: new Date("2026-01-01T10:00:00+07:00"),
      endAt: new Date("2026-01-01T11:00:00+07:00"),
    });
    expect(event.state.startAt.toISOString()).toBe("2026-01-01T03:00:00.000Z");
    expect(event.state.timezone).toBe("Asia/Ho_Chi_Minh");
  });
  it("validates the combined range when partially rescheduled", () => {
    const event = CalendarEvent.create(input);
    expect(() =>
      event.update({ startAt: new Date("2026-01-01T12:00:00Z") }),
    ).toThrow("after start");
  });
});
