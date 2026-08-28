import type {
  Task as TaskRecord,
  CalendarEvent as EventRecord,
  Habit as HabitRecord,
  Reminder as ReminderRecord,
} from "../../generated/client";
import { Task } from "../modules/task/domain/entities/task.entity";
import {
  TaskPriority,
  TaskStatus,
} from "../modules/task/domain/enums/task.enums";
import { CalendarEvent } from "../modules/calendar/domain/entities/calendar-event.entity";
import { CalendarEventType } from "../modules/calendar/domain/enums/calendar-event-type.enum";
import { Habit } from "../modules/habit/domain/entities/habit.entity";
import { HabitFrequency } from "../modules/habit/domain/enums/habit-frequency.enum";
import { Reminder } from "../modules/reminder/domain/entities/reminder.entity";
import {
  ReminderResourceType,
  ReminderStatus,
} from "../modules/reminder/domain/enums/reminder.enums";
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
export const TaskMapper = {
  toDomain: (r: TaskRecord) =>
    Task.restore({
      ...r,
      status: r.status as TaskStatus,
      priority: r.priority as TaskPriority,
    }),
  toPersistence: (e: Task) => e.state,
};
export const CalendarEventMapper = {
  toDomain: (r: EventRecord) =>
    CalendarEvent.restore({
      ...r,
      eventType: r.eventType as CalendarEventType,
    }),
  toPersistence: (e: CalendarEvent) => e.state,
};
export const HabitMapper = {
  toDomain: (r: HabitRecord) =>
    Habit.restore({
      ...r,
      frequencyType: r.frequencyType as HabitFrequency,
      startDate: dateOnly(r.startDate),
      endDate: r.endDate ? dateOnly(r.endDate) : null,
    }),
  toPersistence: (e: Habit) => ({
    ...e.state,
    startDate: new Date(`${e.state.startDate}T00:00:00.000Z`),
    endDate: e.state.endDate
      ? new Date(`${e.state.endDate}T00:00:00.000Z`)
      : null,
  }),
};
export const ReminderMapper = {
  toDomain: (r: ReminderRecord) =>
    Reminder.restore({
      ...r,
      resourceType: r.resourceType as ReminderResourceType,
      status: r.status as ReminderStatus,
    }),
  toPersistence: (e: Reminder) => e.state,
};
