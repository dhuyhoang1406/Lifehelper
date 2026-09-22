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
    Reminder.validateResource(input.resourceType, resourceId);
    const title = Reminder.validateTitle(input.title);
    const timezone = Reminder.validateTimezone(input.timezone);
    Reminder.validateTime(input.remindAt);
    const now = input.createdAt ?? new Date();
    return new Reminder({
      ...input,
      resourceId,
      title,
      timezone,
      status: ReminderStatus.PENDING,
      createdAt: now,
      updatedAt: now,
      cancelledAt: null,
    });
  }
  static restore(p: ReminderProps): Reminder {
    Reminder.validateResource(p.resourceType, p.resourceId);
    Reminder.validateTime(p.remindAt);
    Reminder.validateTimezone(p.timezone);
    return new Reminder(p);
  }
  get state(): Readonly<ReminderProps> {
    return this.props;
  }
  update(
    input: Partial<
      Pick<
        ReminderProps,
        "title" | "remindAt" | "timezone" | "resourceType" | "resourceId"
      >
    >,
    at = new Date(),
  ): void {
    if (this.props.status !== ReminderStatus.PENDING)
      throw new ReminderDomainError("Only pending reminders can be updated");
    const resourceType = input.resourceType ?? this.props.resourceType;
    const resourceId =
      input.resourceId === undefined ? this.props.resourceId : input.resourceId;
    Reminder.validateResource(resourceType, resourceId);
    this.props = {
      ...this.props,
      ...input,
      resourceType,
      resourceId,
      title:
        input.title === undefined
          ? this.props.title
          : Reminder.validateTitle(input.title),
      timezone:
        input.timezone === undefined
          ? this.props.timezone
          : Reminder.validateTimezone(input.timezone),
      remindAt:
        input.remindAt === undefined
          ? this.props.remindAt
          : Reminder.validateTime(input.remindAt),
      updatedAt: at,
    };
  }
  private static validateResource(
    type: ReminderResourceType,
    id: UUID | null,
  ): void {
    if (!Object.values(ReminderResourceType).includes(type))
      throw new ReminderDomainError("Invalid reminder resource type");
    if (type !== ReminderResourceType.CUSTOM && id === null)
      throw new ReminderDomainError("Linked reminder requires a resource id");
    if (type === ReminderResourceType.CUSTOM && id !== null)
      throw new ReminderDomainError("Custom reminder cannot link a resource");
  }
  private static validateTitle(title: string): string {
    const value = title.trim();
    if (!value || value.length > 255)
      throw new ReminderDomainError("Reminder title is invalid");
    return value;
  }
  private static validateTimezone(timezone: string): string {
    const value = timezone.trim();
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    } catch {
      throw new ReminderDomainError("Invalid IANA timezone");
    }
    return value;
  }
  private static validateTime(value: Date): Date {
    if (!(value instanceof Date) || Number.isNaN(value.getTime()))
      throw new ReminderDomainError("Reminder time is invalid");
    return value;
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
