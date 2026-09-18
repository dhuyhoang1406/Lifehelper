import { randomUUID } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  HabitLogRepository,
  HabitRepository,
} from "../../../application/repositories/productivity.repositories";
import {
  HABIT_LOG_REPOSITORY,
  HABIT_REPOSITORY,
} from "../../../application/repositories/productivity.repositories";
import { Habit } from "../domain/entities/habit.entity";
import { HabitLog } from "../domain/entities/habit-log.entity";
import { HabitSchedule } from "../domain/entities/habit-schedule.entity";
import type { HabitFrequency } from "../domain/enums/habit-frequency.enum";
import { HabitDomainError } from "../domain/errors/habit-domain.error";

export interface HabitScheduleInput {
  dayOfWeek: number | null;
  timeOfDay: string | null;
}
export interface CreateHabitInput {
  name: string;
  description?: string;
  frequencyType: HabitFrequency;
  timezone: string;
  targetCount?: number;
  startDate: string;
  endDate?: string;
  schedules?: HabitScheduleInput[];
}
export interface UpdateHabitInput {
  name?: string;
  description?: string | null;
  frequencyType?: HabitFrequency;
  timezone?: string;
  targetCount?: number;
  startDate?: string;
  endDate?: string | null;
  schedules?: HabitScheduleInput[];
}

const buildSchedules = (
  habitId: string,
  inputs: HabitScheduleInput[] = [],
) =>
  inputs.map((input) =>
    HabitSchedule.create({ id: randomUUID(), habitId, ...input }),
  );

@Injectable()
export class CreateHabit {
  constructor(
    @Inject(HABIT_REPOSITORY) private readonly habits: HabitRepository,
  ) {}
  async execute(userId: string, input: CreateHabitInput) {
    const id = randomUUID();
    const { schedules: scheduleInputs, ...habitInput } = input;
    const habit = Habit.create({ id, userId, ...habitInput });
    const schedules = buildSchedules(id, scheduleInputs);
    HabitSchedule.validateForFrequency(habit.state.frequencyType, schedules);
    await this.habits.save(habit, schedules);
    return { ...habit.state, schedules: schedules.map(({ state }) => state) };
  }
}

@Injectable()
export class GetHabit {
  constructor(
    @Inject(HABIT_REPOSITORY) private readonly habits: HabitRepository,
  ) {}
  async execute(userId: string, id: string) {
    const aggregate = await this.habits.findByIdAndUserId(id, userId);
    if (!aggregate) throw new NotFoundException("Habit not found");
    return {
      ...aggregate.habit.state,
      schedules: aggregate.schedules.map(({ state }) => state),
    };
  }
}

@Injectable()
export class ListHabits {
  constructor(
    @Inject(HABIT_REPOSITORY) private readonly habits: HabitRepository,
  ) {}
  async execute(
    userId: string,
    query: { active?: boolean; page: number; limit: number },
  ) {
    const page = await this.habits.findPageByUserId(userId, query);
    return { ...page, items: page.items.map(({ state }) => state) };
  }
}

@Injectable()
export class UpdateHabit {
  constructor(
    @Inject(HABIT_REPOSITORY) private readonly habits: HabitRepository,
  ) {}
  async execute(userId: string, id: string, input: UpdateHabitInput) {
    const aggregate = await this.habits.findByIdAndUserId(id, userId);
    if (!aggregate) throw new NotFoundException("Habit not found");
    const { schedules: scheduleInputs, ...changes } = input;
    aggregate.habit.update(changes);
    const schedules =
      scheduleInputs === undefined
        ? aggregate.schedules
        : buildSchedules(id, scheduleInputs);
    HabitSchedule.validateForFrequency(
      aggregate.habit.state.frequencyType,
      schedules,
    );
    await this.habits.save(
      aggregate.habit,
      scheduleInputs === undefined ? undefined : schedules,
    );
    return {
      ...aggregate.habit.state,
      schedules: schedules.map(({ state }) => state),
    };
  }
}

abstract class HabitLifecycleUseCase {
  constructor(protected readonly habits: HabitRepository) {}
  protected async owned(userId: string, id: string) {
    const aggregate = await this.habits.findByIdAndUserId(id, userId);
    if (!aggregate) throw new NotFoundException("Habit not found");
    return aggregate.habit;
  }
}

@Injectable()
export class PauseHabit extends HabitLifecycleUseCase {
  constructor(@Inject(HABIT_REPOSITORY) habits: HabitRepository) {
    super(habits);
  }
  async execute(userId: string, id: string) {
    const habit = await this.owned(userId, id);
    habit.deactivate();
    await this.habits.save(habit);
    return habit.state;
  }
}

@Injectable()
export class ResumeHabit extends HabitLifecycleUseCase {
  constructor(@Inject(HABIT_REPOSITORY) habits: HabitRepository) {
    super(habits);
  }
  async execute(userId: string, id: string) {
    const habit = await this.owned(userId, id);
    habit.activate();
    await this.habits.save(habit);
    return habit.state;
  }
}

@Injectable()
export class ArchiveHabit extends HabitLifecycleUseCase {
  constructor(@Inject(HABIT_REPOSITORY) habits: HabitRepository) {
    super(habits);
  }
  async execute(userId: string, id: string) {
    const habit = await this.owned(userId, id);
    habit.delete();
    await this.habits.save(habit);
  }
}

@Injectable()
export class LogHabitCompletion {
  constructor(
    @Inject(HABIT_REPOSITORY) private readonly habits: HabitRepository,
    @Inject(HABIT_LOG_REPOSITORY) private readonly logs: HabitLogRepository,
  ) {}
  async execute(
    userId: string,
    habitId: string,
    input: { logDate: string; completedCount?: number; completedAt?: Date },
  ) {
    const aggregate = await this.habits.findByIdAndUserId(habitId, userId);
    if (!aggregate) throw new NotFoundException("Habit not found");
    aggregate.habit.assertCanLog(input.logDate);
    const log = HabitLog.create({
      id: randomUUID(),
      habitId,
      userId,
      ...input,
    });
    await this.logs.save(log);
    return log.state;
  }
}

@Injectable()
export class GetHabitLogs {
  constructor(
    @Inject(HABIT_REPOSITORY) private readonly habits: HabitRepository,
    @Inject(HABIT_LOG_REPOSITORY) private readonly logs: HabitLogRepository,
  ) {}
  async execute(
    userId: string,
    habitId: string,
    query: { from?: string; to?: string; page: number; limit: number },
  ) {
    if (!(await this.habits.findByIdAndUserId(habitId, userId)))
      throw new NotFoundException("Habit not found");
    if (query.from) HabitLog.validateDate(query.from);
    if (query.to) HabitLog.validateDate(query.to);
    if (query.from && query.to && query.to < query.from)
      throw new HabitDomainError("Log date range is invalid");
    return this.logs.findPageByHabitId(habitId, query);
  }
}

@Injectable()
export class UpdateHabitLog {
  constructor(
    @Inject(HABIT_REPOSITORY) private readonly habits: HabitRepository,
    @Inject(HABIT_LOG_REPOSITORY) private readonly logs: HabitLogRepository,
  ) {}
  async execute(
    userId: string,
    habitId: string,
    id: string,
    input: { completedCount?: number; completedAt?: Date },
  ) {
    if (!(await this.habits.findByIdAndUserId(habitId, userId)))
      throw new NotFoundException("Habit not found");
    const log = await this.logs.findByIdAndHabitId(id, habitId);
    if (!log) throw new NotFoundException("Habit log not found");
    log.update(input);
    await this.logs.save(log);
    return log.state;
  }
}
