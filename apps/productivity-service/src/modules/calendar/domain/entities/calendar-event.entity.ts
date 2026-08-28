import type { UUID } from "@lifehelper/shared-types";
import { CalendarEventType } from "../enums/calendar-event-type.enum";
import {
  CalendarDomainError,
  InvalidCalendarRangeError,
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
    if (input.endAt <= input.startAt) throw new InvalidCalendarRangeError();
    if (!input.title.trim() || !input.timezone.trim())
      throw new CalendarDomainError("Title and IANA timezone are required");
    const now = input.createdAt ?? new Date();
    return new CalendarEvent({
      ...input,
      title: input.title.trim(),
      timezone: input.timezone.trim(),
      description: input.description ?? null,
      location: input.location ?? null,
      recurrenceRule: input.recurrenceRule ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }
  static restore(p: CalendarEventProps): CalendarEvent {
    if (p.endAt <= p.startAt) throw new InvalidCalendarRangeError();
    return new CalendarEvent(p);
  }
  get state(): Readonly<CalendarEventProps> {
    return this.props;
  }
  reschedule(startAt: Date, endAt: Date, at = new Date()): void {
    if (endAt <= startAt) throw new InvalidCalendarRangeError();
    this.props.startAt = startAt;
    this.props.endAt = endAt;
    this.props.updatedAt = at;
  }
  delete(at = new Date()): void {
    this.props.deletedAt = at;
    this.props.updatedAt = at;
  }
}
