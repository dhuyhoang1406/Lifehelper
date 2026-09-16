import type { UUID } from "@lifehelper/shared-types";
import { CalendarEventType } from "../enums/calendar-event-type.enum";
import {
  CalendarDomainError,
  InvalidCalendarRangeError,
  InvalidCalendarTimezoneError,
} from "../errors/calendar-domain.error";
export interface CalendarEventProps {
  id: UUID;
  userId: UUID;
  title: string;
  description: string | null;
  eventType: CalendarEventType;
  startAt: Date;
  endAt: Date;
  timezone: string;
  location: string | null;
  recurrenceRule: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
export class CalendarEvent {
  private constructor(private props: CalendarEventProps) {}
  private static assertTimeRange(startAt: Date, endAt: Date): void {
    if (
      Number.isNaN(startAt.getTime()) ||
      Number.isNaN(endAt.getTime()) ||
      endAt <= startAt
    )
      throw new InvalidCalendarRangeError();
  }
  private static normalizeTimezone(timezone: string): string {
    const normalized = timezone.trim();
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format();
    } catch {
      throw new InvalidCalendarTimezoneError(normalized);
    }
    return normalized;
  }
  private static assertEventType(eventType: CalendarEventType): void {
    if (!Object.values(CalendarEventType).includes(eventType))
      throw new CalendarDomainError("Invalid calendar event type");
  }
  static create(
    input: Pick<
      CalendarEventProps,
      "id" | "userId" | "title" | "eventType" | "startAt" | "endAt" | "timezone"
    > &
      Partial<
        Pick<
          CalendarEventProps,
          "description" | "location" | "recurrenceRule" | "createdAt"
        >
      >,
  ): CalendarEvent {
    CalendarEvent.assertTimeRange(input.startAt, input.endAt);
    CalendarEvent.assertEventType(input.eventType);
    if (!input.title.trim()) throw new CalendarDomainError("Title is required");
    const timezone = CalendarEvent.normalizeTimezone(input.timezone);
    const now = input.createdAt ?? new Date();
    return new CalendarEvent({
      ...input,
      title: input.title.trim(),
      timezone,
      description: input.description ?? null,
      location: input.location ?? null,
      recurrenceRule: input.recurrenceRule ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }
  static restore(p: CalendarEventProps): CalendarEvent {
    CalendarEvent.assertTimeRange(p.startAt, p.endAt);
    CalendarEvent.assertEventType(p.eventType);
    CalendarEvent.normalizeTimezone(p.timezone);
    return new CalendarEvent(p);
  }
  get state(): Readonly<CalendarEventProps> {
    return this.props;
  }
  reschedule(startAt: Date, endAt: Date, at = new Date()): void {
    CalendarEvent.assertTimeRange(startAt, endAt);
    this.props.startAt = startAt;
    this.props.endAt = endAt;
    this.props.updatedAt = at;
  }
  update(
    input: Partial<
      Pick<
        CalendarEventProps,
        | "title"
        | "description"
        | "eventType"
        | "startAt"
        | "endAt"
        | "timezone"
        | "location"
        | "recurrenceRule"
      >
    >,
    at = new Date(),
  ): void {
    const title = input.title === undefined ? this.props.title : input.title.trim();
    if (!title) throw new CalendarDomainError("Title is required");
    const startAt = input.startAt ?? this.props.startAt;
    const endAt = input.endAt ?? this.props.endAt;
    CalendarEvent.assertTimeRange(startAt, endAt);
    const eventType = input.eventType ?? this.props.eventType;
    CalendarEvent.assertEventType(eventType);
    this.props = {
      ...this.props,
      ...input,
      title,
      startAt,
      endAt,
      eventType,
      timezone:
        input.timezone === undefined
          ? this.props.timezone
          : CalendarEvent.normalizeTimezone(input.timezone),
      updatedAt: at,
    };
  }
  delete(at = new Date()): void {
    this.props.deletedAt = at;
    this.props.updatedAt = at;
  }
}
