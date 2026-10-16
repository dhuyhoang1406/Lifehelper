import type { Notification } from "../../domain/entities/notification.entity";
import type {
  DeliveryReason,
  SuppressionReason,
} from "../../domain/notification-policy";
export interface DispatchLease {
  notificationId: string;
  owner: string;
  token: number;
}
export interface DeliveryOutcome {
  deliveryId: string;
  result: "SENT" | "FAILED" | "SKIPPED" | "RETRY";
  providerMessageId?: string;
  reason?: DeliveryReason;
}
export interface NotificationDispatchRepository {
  accept(
    consumer: string,
    notification: Notification,
  ): Promise<{ notificationId: string; created: boolean }>;
  claim(owner: string): Promise<DispatchLease | null>;
  resolveTargets(
    lease: DispatchLease,
    deviceSessionIds: string[],
  ): Promise<boolean>;
  settle(
    lease: DispatchLease,
    outcomes: DeliveryOutcome[],
    retryReason?: DeliveryReason,
  ): Promise<boolean>;
  suppress(
    notificationId: string,
    userId: string,
    reason: SuppressionReason,
  ): Promise<boolean>;
}
export const NOTIFICATION_DISPATCH = Symbol("NOTIFICATION_DISPATCH");
