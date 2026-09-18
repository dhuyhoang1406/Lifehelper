import type { UUID } from "@lifehelper/shared-types";
import { HabitDomainError } from "../errors/habit-domain.error";
export interface HabitLogProps {
  id: UUID;
  habitId: UUID;
  userId: UUID;
  logDate: string;
  completedCount: number;
  completedAt: Date;
  createdAt: Date;
}
export class HabitLog {
  private constructor(private props: HabitLogProps) {}
  static create(
    input: Pick<HabitLogProps, "id" | "habitId" | "userId" | "logDate"> &
      Partial<
        Pick<HabitLogProps, "completedCount" | "completedAt" | "createdAt">
      >,
  ): HabitLog {
    HabitLog.validateDate(input.logDate);
    const count = input.completedCount ?? 1;
    if (count < 1)
      throw new HabitDomainError("Completed count must be at least one");
    const completedAt = input.completedAt ?? new Date();
    HabitLog.validateInstant(completedAt);
    return new HabitLog({
      ...input,
      completedCount: count,
      completedAt,
      createdAt: input.createdAt ?? completedAt,
    });
  }
  static restore(p: HabitLogProps): HabitLog {
    HabitLog.validateDate(p.logDate);
    if (p.completedCount < 1)
      throw new HabitDomainError("Completed count must be at least one");
    HabitLog.validateInstant(p.completedAt);
    return new HabitLog(p);
  }
  get state(): Readonly<HabitLogProps> {
    return this.props;
  }
  update(input: { completedCount?: number; completedAt?: Date }): void {
    const count = input.completedCount ?? this.props.completedCount;
    if (count < 1)
      throw new HabitDomainError("Completed count must be at least one");
    this.props.completedCount = count;
    if (input.completedAt !== undefined) {
      HabitLog.validateInstant(input.completedAt);
      this.props.completedAt = input.completedAt;
    }
  }
  static validateDate(value: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new HabitDomainError("Log date must use YYYY-MM-DD format");
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    )
      throw new HabitDomainError("Log date is invalid");
  }
  private static validateInstant(value: Date): void {
    if (Number.isNaN(value.getTime()))
      throw new HabitDomainError("Completion time is invalid");
  }
}
