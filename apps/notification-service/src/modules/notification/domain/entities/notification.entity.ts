import {
  safeReason,
  safeNotificationData,
  validateContent,
  validInstant,
  validateUuid,
  type NotificationContentLimits,
  type DeliveryReason,
  type SuppressionReason,
} from "../notification-policy";
import type { JsonValue, UUID } from "@lifehelper/shared-types";
import {
  NotificationStatus,
  NotificationType,
} from "../enums/notification.enums";
import { NotificationDomainError } from "../errors/notification-domain.error";
export interface NotificationProps {
  id: UUID;
  userId: UUID;
  type: NotificationType;
  title: string;
  body: string;
  data: JsonValue | null;
  sourceEventId: UUID | null;
  status: NotificationStatus;
  createdAt: Date;
  sentAt: Date | null;
  failedAt: Date | null;
  readAt: Date | null;
  sourceReminderId: UUID | null;
  dispatchVersion: number | null;
  eligibleAt: Date;
  expiresAt: Date | null;
  suppressedAt: Date | null;
  suppressionReason: SuppressionReason | null;
  failureReason: DeliveryReason | null;
}
export class Notification {
  private constructor(private props: NotificationProps) {}
  static create(
    input: Pick<
      NotificationProps,
      "id" | "userId" | "type" | "title" | "body"
    > &
      Partial<
        Pick<
          NotificationProps,
          | "data"
          | "sourceEventId"
          | "createdAt"
          | "sourceReminderId"
          | "dispatchVersion"
          | "eligibleAt"
          | "expiresAt"
        >
      >,
    limits: NotificationContentLimits = {
      titleChars: 255,
      bodyChars: 4096,
      dataBytes: 2048,
    },
  ): Notification {
    const data = safeNotificationData(input.data ?? null);
    validateContent(input.title, input.body, data, limits);
    const createdAt = validInstant(input.createdAt ?? new Date());
    const eligibleAt = validInstant(input.eligibleAt ?? createdAt);
    if (input.sourceEventId) validateUuid(input.sourceEventId);
    if (input.type === NotificationType.REMINDER) {
      if (
        !input.sourceEventId ||
        !input.sourceReminderId ||
        !Number.isInteger(input.dispatchVersion) ||
        input.dispatchVersion! < 1 ||
        input.dispatchVersion! > 2147483647 ||
        !input.expiresAt
      )
        throw new NotificationDomainError(
          "Reminder notification requires source event, reminder, version and expiry",
        );
      validateUuid(input.sourceReminderId);
    } else if (input.sourceReminderId != null || input.dispatchVersion != null)
      throw new NotificationDomainError(
        "Only reminder notifications have dispatch identity",
      );
    if (
      input.expiresAt &&
      validInstant(input.expiresAt).getTime() <= eligibleAt.getTime()
    )
      throw new NotificationDomainError(
        "Notification expiry must follow eligibility",
      );
    return new Notification({
      ...input,
      title: input.title.trim(),
      body: input.body.trim(),
      data,
      sourceEventId: input.sourceEventId ?? null,
      status: NotificationStatus.PENDING,
      createdAt,
      eligibleAt,
      expiresAt: input.expiresAt ?? null,
      sourceReminderId: input.sourceReminderId?.toLowerCase() ?? null,
      dispatchVersion: input.dispatchVersion ?? null,
      readAt: null,
      suppressedAt: null,
      suppressionReason: null,
      failureReason: null,
      sentAt: null,
      failedAt: null,
    });
  }
  static restore(
    p: Omit<
      NotificationProps,
      | "readAt"
      | "sourceReminderId"
      | "dispatchVersion"
      | "eligibleAt"
      | "expiresAt"
      | "suppressedAt"
      | "suppressionReason"
      | "failureReason"
    > &
      Partial<NotificationProps>,
  ): Notification {
    return new Notification({
      readAt: null,
      sourceReminderId: null,
      dispatchVersion: null,
      eligibleAt: p.createdAt,
      expiresAt: null,
      suppressedAt: null,
      suppressionReason: null,
      failureReason: null,
      ...p,
    });
  }
  get state(): Readonly<NotificationProps> {
    return this.props;
  }
  startProcessing(): void {
    if (this.props.status !== NotificationStatus.PENDING)
      throw new NotificationDomainError(
        "Only pending notifications can process",
      );
    this.props.status = NotificationStatus.PROCESSING;
  }
  markSent(at = new Date()): void {
    if (this.props.status !== NotificationStatus.PROCESSING)
      throw new NotificationDomainError(
        "Only processing notifications can be sent",
      );
    validInstant(at);
    this.props.failureReason = null;
    this.props.status = NotificationStatus.SENT;
    this.props.sentAt = validInstant(at);
    this.props.failedAt = null;
  }
  markRead(at = new Date()): void {
    this.props.readAt ??= validInstant(at);
  }
  markFailed(
    at = new Date(),
    reason: DeliveryReason = "ALL_DELIVERIES_FAILED",
  ): void {
    if (this.props.status !== NotificationStatus.PROCESSING)
      throw new NotificationDomainError(
        "Only processing notifications can fail",
      );
    validInstant(at);
    this.props.failureReason = safeReason(reason);
    this.props.status = NotificationStatus.FAILED;
    this.props.failedAt = validInstant(at);
  }
}
