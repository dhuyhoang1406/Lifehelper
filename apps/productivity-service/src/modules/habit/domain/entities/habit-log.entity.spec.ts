import { HabitLog } from "./habit-log.entity";

describe("HabitLog", () => {
  const input = {
    id: "log-id",
    habitId: "habit-id",
    userId: "user-id",
    logDate: "2026-01-01",
  };

  it("defaults completed count to one", () => {
    expect(HabitLog.create(input).state.completedCount).toBe(1);
  });

  it("rejects completed count below one", () => {
    expect(() => HabitLog.create({ ...input, completedCount: 0 })).toThrow(
      "at least one",
    );
  });
});
