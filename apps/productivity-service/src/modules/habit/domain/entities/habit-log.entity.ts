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
  private constructor(private readonly props: HabitLogProps) {}
  static create(
    input: Pick<HabitLogProps, "id" | "habitId" | "userId" | "logDate"> &
      Partial<
        Pick<HabitLogProps, "completedCount" | "completedAt" | "createdAt">
      >,
  ): HabitLog {
    const count = input.completedCount ?? 1;
    if (count < 1)
      throw new HabitDomainError("Completed count must be at least one");
    const completedAt = input.completedAt ?? new Date();
    return new HabitLog({
      ...input,
      completedCount: count,
      completedAt,
      createdAt: input.createdAt ?? completedAt,
    });
  }
  static restore(p: HabitLogProps): HabitLog {
    return new HabitLog(p);
  }
  get state(): Readonly<HabitLogProps> {
    return this.props;
  }
}
