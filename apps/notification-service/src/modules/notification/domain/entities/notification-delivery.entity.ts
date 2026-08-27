import type { UUID } from "@lifehelper/shared-types";
import {
  DeliveryStatus,
  NotificationProvider,
} from "../enums/notification.enums";
import { NotificationDomainError } from "../errors/notification-domain.error";
export interface NotificationDeliveryProps {
  id: UUID;
  notificationId: UUID;
  deviceSessionId: UUID;
  provider: NotificationProvider;
  providerMessageId: string | null;
  status: DeliveryStatus;
  attemptCount: number;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export class NotificationDelivery {
  private constructor(private props: NotificationDeliveryProps) {}
  static create(
    input: Pick<
      NotificationDeliveryProps,
      "id" | "notificationId" | "deviceSessionId" | "provider"
    > &
      Partial<Pick<NotificationDeliveryProps, "createdAt">>,
  ): NotificationDelivery {
    const now = input.createdAt ?? new Date();
    return new NotificationDelivery({
      ...input,
      providerMessageId: null,
      status: DeliveryStatus.PENDING,
      attemptCount: 0,
      lastError: null,
      sentAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  static restore(p: NotificationDeliveryProps): NotificationDelivery {
    if (p.attemptCount < 0)
      throw new NotificationDomainError("Attempt count cannot be negative");
    return new NotificationDelivery(p);
  }
  get state(): Readonly<NotificationDeliveryProps> {
    return this.props;
  }
  recordAttempt(at = new Date()): void {
    this.props.attemptCount++;
    this.props.updatedAt = at;
  }
  markSent(providerMessageId: string, at = new Date()): void {
    this.props.status = DeliveryStatus.SENT;
    this.props.providerMessageId = providerMessageId;
    this.props.lastError = null;
    this.props.sentAt = at;
    this.props.updatedAt = at;
  }
  markFailed(error: string, at = new Date()): void {
    this.props.status = DeliveryStatus.FAILED;
    this.props.lastError = error;
    this.props.updatedAt = at;
  }
  skip(reason: string, at = new Date()): void {
    this.props.status = DeliveryStatus.SKIPPED;
    this.props.lastError = reason;
    this.props.updatedAt = at;
  }
}
