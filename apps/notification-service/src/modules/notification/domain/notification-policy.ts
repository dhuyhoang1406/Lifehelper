import type { JsonValue } from "@lifehelper/shared-types";
import { DeliveryStatus, NotificationStatus } from "./enums/notification.enums";
import { NotificationDomainError } from "./errors/notification-domain.error";

export const deliveryReasons = [
  "NO_ACTIVE_DEVICE",
  "ALL_DELIVERIES_FAILED",
  "DEVICE_INACTIVE",
  "INVALID_TOKEN",
  "DISPATCH_CANCELLED",
  "DISPATCH_STALE",
  "DISPATCH_EXPIRED",
  "DISPATCH_ATTEMPTS_EXHAUSTED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_QUOTA",
  "PROVIDER_UNAUTHORIZED",
  "AMBIGUOUS_DELIVERY",
] as const;
export type DeliveryReason = (typeof deliveryReasons)[number];
export type SuppressionReason =
  "DISPATCH_CANCELLED" | "DISPATCH_STALE" | "DISPATCH_EXPIRED";
export interface NotificationContentLimits {
  titleChars: number;
  bodyChars: number;
  dataBytes: number;
}
export function safeReason(reason: string): DeliveryReason {
  if (!(deliveryReasons as readonly string[]).includes(reason))
    throw new NotificationDomainError("Unknown safe delivery reason");
  return reason as DeliveryReason;
}
export function validInstant(at: Date): Date {
  if (!(at instanceof Date) || !Number.isFinite(at.getTime()))
    throw new NotificationDomainError("Invalid notification timestamp");
  return at;
}
export function validateUuid(value: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new NotificationDomainError("Invalid notification reference");
}
export function safeNotificationData(data: JsonValue | null): JsonValue | null {
  if (data === null) return null;
  if (
    typeof data !== "object" ||
    Array.isArray(data) ||
    Object.keys(data).length !== 2 ||
    !("resourceType" in data) ||
    !("resourceId" in data) ||
    typeof data.resourceId !== "string" ||
    typeof data.resourceType !== "string" ||
    !["TASK", "CALENDAR", "HABIT", "REMINDER"].includes(data.resourceType)
  )
    throw new NotificationDomainError(
      "Notification data must be an allowlisted resource reference",
    );
  validateUuid(data.resourceId);
  return {
    resourceType: data.resourceType,
    resourceId: data.resourceId.toLowerCase(),
  };
}
export function validateContent(
  title: string,
  body: string,
  data: JsonValue | null,
  limits: NotificationContentLimits,
): void {
  if (!title.trim() || !body.trim())
    throw new NotificationDomainError(
      "Notification title and body are required",
    );
  if (
    title.trim().length > limits.titleChars ||
    body.trim().length > limits.bodyChars ||
    new TextEncoder().encode(JSON.stringify(data)).byteLength > limits.dataBytes
  )
    throw new NotificationDomainError(
      "Notification content exceeds configured limits",
    );
}
export function aggregateDeliveryState(
  deliveries: readonly { status: DeliveryStatus; sentAt: Date | null }[],
  targetsResolved: boolean,
  suppression: DeliveryReason | null = null,
): {
  status: NotificationStatus;
  reason: DeliveryReason | null;
  sentAt: Date | null;
} {
  const sent = deliveries.filter(
    (delivery) => delivery.status === DeliveryStatus.SENT,
  );
  if (sent.length)
    return {
      status: NotificationStatus.SENT,
      reason: null,
      sentAt:
        sent
          .map((d) => d.sentAt)
          .filter((d): d is Date => d !== null)
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
    };
  if (suppression)
    return {
      status: NotificationStatus.FAILED,
      reason: suppression,
      sentAt: null,
    };
  if (targetsResolved && deliveries.length === 0)
    return {
      status: NotificationStatus.FAILED,
      reason: "NO_ACTIVE_DEVICE",
      sentAt: null,
    };
  if (
    targetsResolved &&
    deliveries.every((d) => d.status !== DeliveryStatus.PENDING)
  )
    return {
      status: NotificationStatus.FAILED,
      reason: "ALL_DELIVERIES_FAILED",
      sentAt: null,
    };
  return { status: NotificationStatus.PROCESSING, reason: null, sentAt: null };
}
