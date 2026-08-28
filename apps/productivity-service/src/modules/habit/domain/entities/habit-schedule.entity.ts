import type { UUID } from "@lifehelper/shared-types";
import { HabitDomainError } from "../errors/habit-domain.error";
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
      (input.dayOfWeek < 1 || input.dayOfWeek > 7)
    )
      throw new HabitDomainError("Day of week must be between 1 and 7");
    return new HabitSchedule({
      ...input,
      createdAt: input.createdAt ?? new Date(),
    });
  }
  static restore(p: HabitScheduleProps): HabitSchedule {
    return new HabitSchedule(p);
  }
  get state(): Readonly<HabitScheduleProps> {
    return this.props;
  }
}
