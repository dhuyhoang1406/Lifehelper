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
});
