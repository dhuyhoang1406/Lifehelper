import { Notification } from "./notification.entity";
import {
  NotificationStatus,
  NotificationType,
} from "../enums/notification.enums";

describe("Notification", () => {
  const input = {
    id: "notification-id",
    userId: "user-id",
    type: NotificationType.SYSTEM,
    title: "Notice",
    body: "Content",
  };

  it("rejects a whitespace-only body", () => {
    expect(() => Notification.create({ ...input, body: "   " })).toThrow(
      "required",
    );
  });

  it("only marks a processing notification as sent", () => {
    const notification = Notification.create(input);
    expect(() => notification.markSent()).toThrow("processing");
    notification.startProcessing();
    notification.markSent();
    expect(notification.state.status).toBe(NotificationStatus.SENT);
  });
});
