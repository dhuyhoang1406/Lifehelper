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
}
export class Notification {
  private constructor(private props: NotificationProps) {}
  static create(
    input: Pick<
      NotificationProps,
      "id" | "userId" | "type" | "title" | "body"
    > &
      Partial<Pick<NotificationProps, "data" | "sourceEventId" | "createdAt">>,
  ): Notification {
    if (!input.title.trim() || !input.body)
      throw new NotificationDomainError(
        "Notification title and body are required",
      );
    return new Notification({
      ...input,
      title: input.title.trim(),
      data: input.data ?? null,
      sourceEventId: input.sourceEventId ?? null,
      status: NotificationStatus.PENDING,
      createdAt: input.createdAt ?? new Date(),
      sentAt: null,
      failedAt: null,
    });
  }
  static restore(p: NotificationProps): Notification {
    return new Notification(p);
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
    this.props.status = NotificationStatus.SENT;
    this.props.sentAt = at;
    this.props.failedAt = null;
  }
  markFailed(at = new Date()): void {
    this.props.status = NotificationStatus.FAILED;
    this.props.failedAt = at;
  }
}
