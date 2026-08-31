import type { UUID } from "@lifehelper/shared-types";
import type { Task } from "../../modules/task/domain/entities/task.entity";
import type { CalendarEvent } from "../../modules/calendar/domain/entities/calendar-event.entity";
import type { Habit } from "../../modules/habit/domain/entities/habit.entity";
import type { Reminder } from "../../modules/reminder/domain/entities/reminder.entity";
export interface TaskQuery {
  status?: string;
  dueBefore?: Date;
  includeDeleted?: boolean;
}
export interface TaskRepository {
  findById(id: UUID): Promise<Task | null>;
  findByUserId(userId: UUID, query?: TaskQuery): Promise<Task[]>;
  save(entity: Task): Promise<void>;
}
export interface CalendarEventRepository {
  findById(id: UUID): Promise<CalendarEvent | null>;
  findByUserAndRange(
    userId: UUID,
    start: Date,
    end: Date,
  ): Promise<CalendarEvent[]>;
  save(entity: CalendarEvent): Promise<void>;
}
export interface HabitRepository {
  findById(id: UUID): Promise<Habit | null>;
  findActiveByUserId(userId: UUID): Promise<Habit[]>;
  save(entity: Habit): Promise<void>;
}
export interface ReminderRepository {
  findById(id: UUID): Promise<Reminder | null>;
  findPendingBefore(at: Date): Promise<Reminder[]>;
  save(entity: Reminder): Promise<void>;
}
