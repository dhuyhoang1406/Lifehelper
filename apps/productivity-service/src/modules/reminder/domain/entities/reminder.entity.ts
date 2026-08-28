import type { UUID } from "@lifehelper/shared-types";
import { ReminderResourceType, ReminderStatus } from "../enums/reminder.enums";
import { ReminderDomainError } from "../errors/reminder-domain.error";
export interface ReminderProps {
  id: UUID;
  userId: UUID;
  resourceType: ReminderResourceType;
  resourceId: UUID | null;
  title: string;
  remindAt: Date;
  timezone: string;
  status: ReminderStatus;
  createdAt: Date;
  updatedAt: Date;
  cancelledAt: Date | null;
}
export class Reminder {
  private constructor(private props: ReminderProps) {}
  static create(
    input: Pick<
      ReminderProps,
      "id" | "userId" | "resourceType" | "title" | "remindAt" | "timezone"
    > &
      Partial<Pick<ReminderProps, "resourceId" | "createdAt">>,
  ): Reminder {
    const resourceId = input.resourceId ?? null;
    if (
      input.resourceType !== ReminderResourceType.CUSTOM &&
      resourceId === null
    )
      throw new ReminderDomainError("Linked reminder requires a resource id");
    if (!input.title.trim() || !input.timezone.trim())
      throw new ReminderDomainError("Reminder title and timezone are required");
    const now = input.createdAt ?? new Date();
    return new Reminder({
      ...input,
      resourceId,
      title: input.title.trim(),
      timezone: input.timezone.trim(),
      status: ReminderStatus.PENDING,
      createdAt: now,
      updatedAt: now,
      cancelledAt: null,
    });
  }
  static restore(p: ReminderProps): Reminder {
    return new Reminder(p);
  }
  get state(): Readonly<ReminderProps> {
    return this.props;
  }
  queue(at = new Date()): void {
    if (this.props.status !== ReminderStatus.PENDING)
      throw new ReminderDomainError("Only pending reminders can queue");
    this.props.status = ReminderStatus.QUEUED;
    this.props.updatedAt = at;
  }
  markSent(at = new Date()): void {
    if (this.props.status !== ReminderStatus.QUEUED)
      throw new ReminderDomainError("Only queued reminders can be sent");
    this.props.status = ReminderStatus.SENT;
    this.props.updatedAt = at;
  }
  markFailed(at = new Date()): void {
    this.props.status = ReminderStatus.FAILED;
    this.props.updatedAt = at;
  }
  cancel(at = new Date()): void {
    if (this.props.status === ReminderStatus.SENT)
      throw new ReminderDomainError("Sent reminder cannot be cancelled");
    this.props.status = ReminderStatus.CANCELLED;
    this.props.cancelledAt = at;
    this.props.updatedAt = at;
  }
}
