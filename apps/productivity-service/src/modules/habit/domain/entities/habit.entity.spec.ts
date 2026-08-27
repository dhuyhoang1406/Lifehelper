import { Habit } from "./habit.entity";
import { HabitFrequency } from "../enums/habit-frequency.enum";
describe("Habit", () => {
  const input = {
    id: "habit-id",
    userId: "user-id",
    name: "Exercise",
    frequencyType: HabitFrequency.DAILY,
    startDate: "2026-01-01",
  };
  it("defaults target to one", () =>
    expect(Habit.create(input).state.targetCount).toBe(1));
  it("rejects invalid target", () =>
    expect(() => Habit.create({ ...input, targetCount: 0 })).toThrow(
      "at least one",
    ));
  it("rejects end date before start date", () =>
    expect(() => Habit.create({ ...input, endDate: "2025-12-31" })).toThrow(
      "precede",
    ));
});
