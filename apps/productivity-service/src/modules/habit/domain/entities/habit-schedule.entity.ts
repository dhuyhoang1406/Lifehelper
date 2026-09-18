import type { UUID } from "@lifehelper/shared-types";
import { HabitDomainError } from "../errors/habit-domain.error";
import { HabitFrequency } from "../enums/habit-frequency.enum";
export interface HabitScheduleProps {
  id: UUID;
  habitId: UUID;
  dayOfWeek: number | null;
  timeOfDay: string | null;
  createdAt: Date;
}
export class HabitSchedule {
  private constructor(private readonly props: HabitScheduleProps) {}
  static create(
    input: Omit<HabitScheduleProps, "createdAt"> &
      Partial<Pick<HabitScheduleProps, "createdAt">>,
  ): HabitSchedule {
    if (
      input.dayOfWeek !== null &&
      (!Number.isInteger(input.dayOfWeek) ||
        input.dayOfWeek < 1 ||
        input.dayOfWeek > 7)
    )
      throw new HabitDomainError("Day of week must be between 1 and 7");
    if (
      input.timeOfDay !== null &&
      !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(input.timeOfDay)
    )
      throw new HabitDomainError("Time of day is invalid");
    return new HabitSchedule({
      ...input,
      createdAt: input.createdAt ?? new Date(),
    });
  }
  static restore(p: HabitScheduleProps): HabitSchedule {
    return HabitSchedule.create(p);
  }
  get state(): Readonly<HabitScheduleProps> {
    return this.props;
  }
  static validateForFrequency(
    frequency: HabitFrequency,
    schedules: readonly HabitSchedule[],
  ): void {
    if (frequency === HabitFrequency.WEEKLY && schedules.length === 0)
      throw new HabitDomainError("Weekly habits require a schedule");
    if (
      frequency === HabitFrequency.WEEKLY &&
      schedules.some(({ state }) => state.dayOfWeek === null)
    )
      throw new HabitDomainError("Weekly schedules require a day of week");
    if (
      frequency === HabitFrequency.DAILY &&
      schedules.some(({ state }) => state.dayOfWeek !== null)
    )
      throw new HabitDomainError("Daily schedules cannot specify a day of week");
    const keys = schedules.map(
      ({ state }) => `${state.dayOfWeek ?? "daily"}:${state.timeOfDay ?? "any"}`,
    );
    if (new Set(keys).size !== keys.length)
      throw new HabitDomainError("Habit schedules must be unique");
  }
}
