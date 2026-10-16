import { Notification } from "./entities/notification.entity";
import { NotificationDelivery } from "./entities/notification-delivery.entity";
import {
  aggregateDeliveryState,
  safeNotificationData,
} from "./notification-policy";
import {
  DeliveryStatus as D,
  NotificationType as T,
  NotificationProvider,
} from "./enums/notification.enums";
const id = "00000000-0000-4000-8000-000000000001";
const at = new Date("2026-10-19T08:00:00+07:00");
const notification = () =>
  Notification.create({
    id,
    userId: id,
    type: T.SYSTEM,
    title: "Title",
    body: "Body",
    createdAt: at,
  });
describe("Notification state and safe content", () => {
  it("aggregates acceptance independently from remaining retries", () => {
    expect(
      aggregateDeliveryState(
        [
          { status: D.SENT, sentAt: at },
          { status: D.PENDING, sentAt: null },
        ],
        true,
      ),
    ).toMatchObject({ status: "SENT", sentAt: at });
    expect(
      aggregateDeliveryState(
        [{ status: D.SENT, sentAt: at }],
        true,
        "DISPATCH_CANCELLED",
      ).status,
    ).toBe("SENT");
  });
  it("does not confuse unresolved, absent and terminal targets", () => {
    expect(aggregateDeliveryState([], false).status).toBe("PROCESSING");
    expect(aggregateDeliveryState([], true).reason).toBe("NO_ACTIVE_DEVICE");
    expect(
      aggregateDeliveryState([{ status: D.FAILED, sentAt: null }], true).reason,
    ).toBe("ALL_DELIVERIES_FAILED");
  });
  it("keeps reading independent and serializes instants in UTC", () => {
    const n = notification();
    n.markRead(at);
    n.markRead(new Date());
    expect(n.state.status).toBe("PENDING");
    expect(n.state.readAt?.toISOString()).toBe("2026-10-19T01:00:00.000Z");
  });
  it.each<import("@lifehelper/shared-types").JsonValue>([
    { url: "https://example.com" },
    { token: "secret" },
    { resourceType: "TASK", resourceId: id, extra: true },
  ])("rejects unsafe payload %p", (data) => {
    expect(() => safeNotificationData(data)).toThrow("allowlisted");
  });
  it("requires new reminders to carry occurrence identity and expiry", () => {
    expect(() =>
      Notification.create({ ...notification().state, type: T.REMINDER }),
    ).toThrow("requires");
    expect(() =>
      Notification.create({
        ...notification().state,
        type: T.REMINDER,
        sourceEventId: id,
        sourceReminderId: id,
        dispatchVersion: 1,
        expiresAt: at,
      }),
    ).toThrow("expiry");
  });
  it("bounds display content", () => {
    expect(() =>
      Notification.create({ ...notification().state, title: "a".repeat(256) }),
    ).toThrow("limits");
  });
  it("keeps retry pending and terminal outcomes immutable", () => {
    const d = NotificationDelivery.create({
      id,
      notificationId: id,
      deviceSessionId: id,
      provider: NotificationProvider.FCM,
    });
    expect(() => d.retry("PROVIDER_TIMEOUT", at, at)).toThrow("future");
    expect(d.state.lastError).toBeNull();
    d.recordAttempt(at);
    d.retry("PROVIDER_TIMEOUT", new Date(at.getTime() + 1000), at);
    expect(d.state.status).toBe("PENDING");
    d.markSent("fcm-reference", at);
    expect(() => d.markFailed("PROVIDER_TIMEOUT")).toThrow("Terminal");
  });
  it("rejects raw provider errors", () => {
    const d = NotificationDelivery.create({
      id,
      notificationId: id,
      deviceSessionId: id,
      provider: NotificationProvider.FCM,
    });
    expect(() => d.markFailed("raw token or payload")).toThrow("safe");
  });
});
