import type { UUID } from "@lifehelper/shared-types";
import type { Task } from "../../modules/task/domain/entities/task.entity";
import type { CalendarEvent } from "../../modules/calendar/domain/entities/calendar-event.entity";
import type { Habit } from "../../modules/habit/domain/entities/habit.entity";
import type { Reminder } from "../../modules/reminder/domain/entities/reminder.entity";
import type { Subtask } from "../../modules/task/domain/entities/subtask.entity";
import type { Tag } from "../../modules/task/domain/entities/tag.entity";
export interface TaskQuery {
  status?: string;
  priority?: string;
  dueAt?: Date;
  tag?: string;
  search?: string;
  sort?: "createdAt" | "updatedAt" | "dueAt" | "priority";
  direction?: "asc" | "desc";
  page: number;
  limit: number;
}
export interface TaskPage {
  items: Task[];
  total: number;
  page: number;
  limit: number;
}
export interface TaskRepository {
  findByIdAndUserId(id: UUID, userId: UUID): Promise<Task | null>;
  findPageByUserId(userId: UUID, query: TaskQuery): Promise<TaskPage>;
  save(entity: Task): Promise<void>;
}
export interface SubtaskRepository {
  findByIdAndTaskId(id: UUID, taskId: UUID): Promise<Subtask | null>;
  findByTaskId(taskId: UUID): Promise<Subtask[]>;
  save(entity: Subtask): Promise<void>;
  delete(id: UUID): Promise<void>;
}
export interface TagRepository {
  findByIdAndUserId(id: UUID, userId: UUID): Promise<Tag | null>;
  findByUserId(userId: UUID): Promise<Tag[]>;
  findByNormalizedName(
    userId: UUID,
    normalizedName: string,
  ): Promise<Tag | null>;
  save(entity: Tag): Promise<void>;
  delete(id: UUID): Promise<void>;
}
export interface TaskTagRepository {
  attach(taskId: UUID, tagId: UUID): Promise<void>;
  detach(taskId: UUID, tagId: UUID): Promise<void>;
}
export interface CalendarEventRepository {
  findByIdAndUserId(id: UUID, userId: UUID): Promise<CalendarEvent | null>;
  findByUserAndRange(
    userId: UUID,
    from?: Date,
    to?: Date,
    page?: number,
    limit?: number,
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
export const TASK_REPOSITORY = Symbol("TASK_REPOSITORY");
export const SUBTASK_REPOSITORY = Symbol("SUBTASK_REPOSITORY");
export const TAG_REPOSITORY = Symbol("TAG_REPOSITORY");
export const TASK_TAG_REPOSITORY = Symbol("TASK_TAG_REPOSITORY");
export const CALENDAR_EVENT_REPOSITORY = Symbol("CALENDAR_EVENT_REPOSITORY");
