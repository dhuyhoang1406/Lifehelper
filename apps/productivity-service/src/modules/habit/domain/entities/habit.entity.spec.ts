import { Habit } from "./habit.entity";
import { HabitFrequency } from "../enums/habit-frequency.enum";
describe("Habit", () => {
  const input = {
    id: "habit-id",
    userId: "user-id",
    name: "Exercise",
    frequencyType: HabitFrequency.DAILY,
    timezone: "Asia/Ho_Chi_Minh",
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
  it("pauses, resumes, and archives through domain behavior", () => {
    const habit = Habit.create(input);
    habit.deactivate();
    expect(habit.state.isActive).toBe(false);
    habit.activate();
    expect(habit.state.isActive).toBe(true);
    habit.delete();
    expect(habit.state).toMatchObject({ isActive: false });
    expect(habit.state.deletedAt).toBeInstanceOf(Date);
    expect(() => habit.activate()).toThrow("Deleted habit");
  });
  it("rejects an invalid timezone", () =>
    expect(() => Habit.create({ ...input, timezone: "Invalid/Zone" })).toThrow(
      "Invalid IANA timezone",
    ));
});
