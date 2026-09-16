import { randomUUID } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CalendarEventRepository } from "../../../application/repositories/productivity.repositories";
import { CALENDAR_EVENT_REPOSITORY } from "../../../application/repositories/productivity.repositories";
import { CalendarEvent } from "../domain/entities/calendar-event.entity";
import type { CalendarEventType } from "../domain/enums/calendar-event-type.enum";
import { InvalidCalendarRangeError } from "../domain/errors/calendar-domain.error";

export interface CreateCalendarEventInput {
  title: string;
  description?: string;
  eventType: CalendarEventType;
  startAt: Date;
  endAt: Date;
  timezone: string;
  location?: string;
  recurrenceRule?: string;
}

export interface UpdateCalendarEventInput {
  title?: string;
  description?: string | null;
  eventType?: CalendarEventType;
  startAt?: Date;
  endAt?: Date;
  timezone?: string;
  location?: string | null;
  recurrenceRule?: string | null;
}

@Injectable()
export class CreateCalendarEvent {
  constructor(
    @Inject(CALENDAR_EVENT_REPOSITORY)
    private readonly events: CalendarEventRepository,
  ) {}
  async execute(userId: string, input: CreateCalendarEventInput) {
    const event = CalendarEvent.create({ id: randomUUID(), userId, ...input });
    await this.events.save(event);
    return event.state;
  }
}

@Injectable()
export class GetCalendarEvent {
  constructor(
    @Inject(CALENDAR_EVENT_REPOSITORY)
    private readonly events: CalendarEventRepository,
  ) {}
  async execute(userId: string, id: string) {
    const event = await this.events.findByIdAndUserId(id, userId);
    if (!event) throw new NotFoundException("Calendar event not found");
    return event.state;
  }
}

@Injectable()
export class ListCalendarEvents {
  constructor(
    @Inject(CALENDAR_EVENT_REPOSITORY)
    private readonly events: CalendarEventRepository,
  ) {}
  async execute(
    userId: string,
    from?: Date,
    to?: Date,
    page = 1,
    limit = 50,
  ) {
    if ((from && !to) || (!from && to) || (from && to && to <= from))
      throw new InvalidCalendarRangeError();
    return (
      await this.events.findByUserAndRange(userId, from, to, page, limit)
    ).map((event) => event.state);
  }
}

@Injectable()
export class UpdateCalendarEvent {
  constructor(
    @Inject(CALENDAR_EVENT_REPOSITORY)
    private readonly events: CalendarEventRepository,
  ) {}
  async execute(userId: string, id: string, input: UpdateCalendarEventInput) {
    const event = await this.events.findByIdAndUserId(id, userId);
    if (!event) throw new NotFoundException("Calendar event not found");
    event.update(input);
    await this.events.save(event);
    return event.state;
  }
}

@Injectable()
export class DeleteCalendarEvent {
  constructor(
    @Inject(CALENDAR_EVENT_REPOSITORY)
    private readonly events: CalendarEventRepository,
  ) {}
  async execute(userId: string, id: string) {
    const event = await this.events.findByIdAndUserId(id, userId);
    if (!event) throw new NotFoundException("Calendar event not found");
    event.delete();
    await this.events.save(event);
  }
}
