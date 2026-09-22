import { Reminder } from "./reminder.entity";
import { ReminderResourceType, ReminderStatus } from "../enums/reminder.enums";

describe("Reminder", () => {
  const createReminder = () =>
    Reminder.create({
      id: "reminder-id",
      userId: "user-id",
      resourceType: ReminderResourceType.CUSTOM,
      title: "Buy milk",
      remindAt: new Date("2026-01-01T00:00:00Z"),
      timezone: "Asia/Ho_Chi_Minh",
    });

  it("only marks a queued reminder as sent", () => {
    const reminder = createReminder();
    expect(() => reminder.markSent()).toThrow("queued");
    reminder.queue();
    reminder.markSent();
    expect(reminder.state.status).toBe(ReminderStatus.SENT);
  });
  it("validates timezone and resource reference", () => {
    expect(() =>
      Reminder.create({
        id: "r",
        userId: "u",
        resourceType: ReminderResourceType.TASK,
        title: "Task",
        remindAt: new Date(),
        timezone: "UTC",
      }),
    ).toThrow("resource id");
    expect(() =>
      Reminder.create({
        id: "r",
        userId: "u",
        resourceType: ReminderResourceType.CUSTOM,
        title: "Task",
        remindAt: new Date(),
        timezone: "Invalid/Zone",
      }),
    ).toThrow("IANA timezone");
  });
  it("preserves an offset instant and prevents updates after cancellation", () => {
    const reminder = Reminder.create({
      id: "r",
      userId: "u",
      resourceType: ReminderResourceType.CUSTOM,
      title: "Task",
      remindAt: new Date("2026-09-22T09:00:00+07:00"),
      timezone: "Asia/Ho_Chi_Minh",
    });
    expect(reminder.state.remindAt.toISOString()).toBe(
      "2026-09-22T02:00:00.000Z",
    );
    reminder.cancel();
    expect(reminder.state.status).toBe(ReminderStatus.CANCELLED);
    expect(() => reminder.update({ title: "Changed" })).toThrow("pending");
  });
});
