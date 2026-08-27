import { NotificationDelivery } from "./notification-delivery.entity";
import {
  DeliveryStatus,
  NotificationProvider,
} from "../enums/notification.enums";
describe("NotificationDelivery", () => {
  it("tracks attempts and delivery result", () => {
    const delivery = NotificationDelivery.create({
      id: "delivery-id",
      notificationId: "notification-id",
      deviceSessionId: "session-id",
      provider: NotificationProvider.FCM,
    });
    delivery.recordAttempt();
    delivery.markSent("provider-id");
    expect(delivery.state).toMatchObject({
      attemptCount: 1,
      status: DeliveryStatus.SENT,
      providerMessageId: "provider-id",
    });
  });
  it("rejects negative restored attempts", () =>
    expect(() =>
      NotificationDelivery.restore({
        id: "d",
        notificationId: "n",
        deviceSessionId: "s",
        provider: NotificationProvider.FCM,
        providerMessageId: null,
        status: DeliveryStatus.PENDING,
        attemptCount: -1,
        lastError: null,
        sentAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toThrow("negative"));
});
