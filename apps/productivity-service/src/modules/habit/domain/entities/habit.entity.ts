import type { UUID } from "@lifehelper/shared-types";
import { HabitFrequency } from "../enums/habit-frequency.enum";
import { HabitDomainError } from "../errors/habit-domain.error";
export interface HabitProps {
  id: UUID;
  userId: UUID;
  name: string;
  description: string | null;
  frequencyType: HabitFrequency;
  timezone: string;
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
      "id" | "userId" | "name" | "frequencyType" | "timezone" | "startDate"
    > &
      Partial<
        Pick<
          HabitProps,
          "description" | "targetCount" | "endDate" | "createdAt"
        >
      >,
  ): Habit {
    const target = input.targetCount ?? 1;
    if (!Number.isInteger(target) || target < 1)
      throw new HabitDomainError("Habit target count must be at least one");
    Habit.validateFrequency(input.frequencyType);
    Habit.validateDate(input.startDate);
    if (input.endDate) Habit.validateDate(input.endDate);
    if (input.endDate && input.endDate < input.startDate)
      throw new HabitDomainError("Habit end date cannot precede start date");
    if (!input.name.trim())
      throw new HabitDomainError("Habit name is required");
    const timezone = Habit.validateTimezone(input.timezone);
    const now = input.createdAt ?? new Date();
    return new Habit({
      ...input,
      name: input.name.trim(),
      description: input.description ?? null,
      timezone,
      targetCount: target,
      endDate: input.endDate ?? null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }
  static restore(p: HabitProps): Habit {
    if (!p.name.trim()) throw new HabitDomainError("Habit name is required");
    if (!Number.isInteger(p.targetCount) || p.targetCount < 1)
      throw new HabitDomainError("Habit target count must be at least one");
    Habit.validateFrequency(p.frequencyType);
    Habit.validateDate(p.startDate);
    if (p.endDate) Habit.validateDate(p.endDate);
    Habit.validateDateRange(p.startDate, p.endDate);
    Habit.validateTimezone(p.timezone);
    return new Habit(p);
  }
  get state(): Readonly<HabitProps> {
    return this.props;
  }
  update(
    input: Partial<
      Pick<
        HabitProps,
        | "name"
        | "description"
        | "frequencyType"
        | "timezone"
        | "targetCount"
        | "startDate"
        | "endDate"
      >
    >,
    at = new Date(),
  ): void {
    const name = input.name === undefined ? this.props.name : input.name.trim();
    if (!name) throw new HabitDomainError("Habit name is required");
    const targetCount = input.targetCount ?? this.props.targetCount;
    if (!Number.isInteger(targetCount) || targetCount < 1)
      throw new HabitDomainError("Habit target count must be at least one");
    const startDate = input.startDate ?? this.props.startDate;
    const endDate =
      input.endDate === undefined ? this.props.endDate : input.endDate;
    Habit.validateFrequency(input.frequencyType ?? this.props.frequencyType);
    Habit.validateDate(startDate);
    if (endDate) Habit.validateDate(endDate);
    Habit.validateDateRange(startDate, endDate);
    this.props = {
      ...this.props,
      ...input,
      name,
      targetCount,
      startDate,
      endDate,
      timezone:
        input.timezone === undefined
          ? this.props.timezone
          : Habit.validateTimezone(input.timezone),
      updatedAt: at,
    };
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
  assertCanLog(logDate: string): void {
    Habit.validateDate(logDate);
    if (!this.props.isActive || this.props.deletedAt)
      throw new HabitDomainError("Inactive habit cannot be logged");
    if (
      logDate < this.props.startDate ||
      (this.props.endDate !== null && logDate > this.props.endDate)
    )
      throw new HabitDomainError("Log date is outside the habit date range");
  }
  delete(at = new Date()): void {
    this.props.isActive = false;
    this.props.deletedAt = at;
    this.props.updatedAt = at;
  }
  private static validateTimezone(timezone: string): string {
    const normalized = timezone.trim();
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format();
    } catch {
      throw new HabitDomainError(`Invalid IANA timezone: ${normalized}`);
    }
    return normalized;
  }
  private static validateDateRange(startDate: string, endDate: string | null) {
    if (endDate && endDate < startDate)
      throw new HabitDomainError("Habit end date cannot precede start date");
  }
  private static validateDate(value: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new HabitDomainError("Habit date must use YYYY-MM-DD format");
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    )
      throw new HabitDomainError("Habit date is invalid");
  }
  private static validateFrequency(frequency: HabitFrequency): void {
    if (!Object.values(HabitFrequency).includes(frequency))
      throw new HabitDomainError("Invalid habit frequency");
  }
}
