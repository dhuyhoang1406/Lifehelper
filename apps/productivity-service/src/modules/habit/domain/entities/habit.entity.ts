import type { UUID } from "@lifehelper/shared-types";
import { HabitFrequency } from "../enums/habit-frequency.enum";
import { HabitDomainError } from "../errors/habit-domain.error";
export interface HabitProps {
  id: UUID;
  userId: UUID;
  name: string;
  description: string | null;
  frequencyType: HabitFrequency;
  targetCount: number;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
export class Habit {
  private constructor(private props: HabitProps) {}
  static create(
    input: Pick<
      HabitProps,
      "id" | "userId" | "name" | "frequencyType" | "startDate"
    > &
      Partial<
        Pick<
          HabitProps,
          "description" | "targetCount" | "endDate" | "createdAt"
        >
      >,
  ): Habit {
    const target = input.targetCount ?? 1;
    if (target < 1)
      throw new HabitDomainError("Habit target count must be at least one");
    if (input.endDate && input.endDate < input.startDate)
      throw new HabitDomainError("Habit end date cannot precede start date");
    if (!input.name.trim())
      throw new HabitDomainError("Habit name is required");
    const now = input.createdAt ?? new Date();
    return new Habit({
      ...input,
      name: input.name.trim(),
      description: input.description ?? null,
      targetCount: target,
      endDate: input.endDate ?? null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }
  static restore(p: HabitProps): Habit {
    return new Habit(p);
  }
  get state(): Readonly<HabitProps> {
    return this.props;
  }
  deactivate(at = new Date()): void {
    this.props.isActive = false;
    this.props.updatedAt = at;
  }
  activate(at = new Date()): void {
    if (this.props.deletedAt)
      throw new HabitDomainError("Deleted habit cannot be activated");
    this.props.isActive = true;
    this.props.updatedAt = at;
  }
  delete(at = new Date()): void {
    this.props.isActive = false;
    this.props.deletedAt = at;
    this.props.updatedAt = at;
  }
}
