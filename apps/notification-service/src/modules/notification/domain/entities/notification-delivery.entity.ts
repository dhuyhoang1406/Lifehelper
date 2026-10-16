import { safeReason, validInstant } from "../notification-policy";
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
  failedAt: Date | null;
  skippedAt: Date | null;
  nextAttemptAt: Date;
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
    const now = validInstant(input.createdAt ?? new Date());
    return new NotificationDelivery({
      ...input,
      providerMessageId: null,
      status: DeliveryStatus.PENDING,
      attemptCount: 0,
      lastError: null,
      sentAt: null,
      failedAt: null,
      skippedAt: null,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
  static restore(
    p: Omit<
      NotificationDeliveryProps,
      "failedAt" | "skippedAt" | "nextAttemptAt"
    > &
      Partial<NotificationDeliveryProps>,
  ): NotificationDelivery {
    if (!Number.isSafeInteger(p.attemptCount) || p.attemptCount < 0)
      throw new NotificationDomainError("Attempt count cannot be negative");
    return new NotificationDelivery({
      failedAt: null,
      skippedAt: null,
      nextAttemptAt: p.createdAt,
      ...p,
    });
  }
  get state(): Readonly<NotificationDeliveryProps> {
    return this.props;
  }
  private pending(): void {
    if (this.props.status !== DeliveryStatus.PENDING)
      throw new NotificationDomainError("Terminal deliveries cannot change");
  }
  recordAttempt(at = new Date()): void {
    this.pending();
    validInstant(at);
    this.props.attemptCount++;
    this.props.updatedAt = at;
  }
  markSent(providerMessageId: string, at = new Date()): void {
    this.pending();
    validInstant(at);
    if (!providerMessageId.trim() || providerMessageId.length > 255)
      throw new NotificationDomainError("Invalid provider message reference");
    this.props.status = DeliveryStatus.SENT;
    this.props.providerMessageId = providerMessageId;
    this.props.lastError = null;
    this.props.sentAt = at;
    this.props.updatedAt = at;
  }
  retry(reason: string, nextAttemptAt: Date, at = new Date()): void {
    this.pending();
    safeReason(reason);
    validInstant(nextAttemptAt);
    validInstant(at);
    if (nextAttemptAt <= at)
      throw new NotificationDomainError(
        "Retry must be scheduled in the future",
      );
    this.props.lastError = reason;
    this.props.nextAttemptAt = nextAttemptAt;
    this.props.updatedAt = at;
  }
  markFailed(error: string, at = new Date()): void {
    this.pending();
    validInstant(at);
    safeReason(error);
    this.props.failedAt = at;
    this.props.status = DeliveryStatus.FAILED;
    this.props.lastError = error;
    this.props.updatedAt = at;
  }
  skip(reason: string, at = new Date()): void {
    this.pending();
    validInstant(at);
    safeReason(reason);
    this.props.skippedAt = at;
    this.props.status = DeliveryStatus.SKIPPED;
    this.props.lastError = reason;
    this.props.updatedAt = at;
  }
}
