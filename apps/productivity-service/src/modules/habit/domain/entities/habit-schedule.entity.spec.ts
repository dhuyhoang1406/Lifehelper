import { HabitSchedule } from "./habit-schedule.entity";
import { HabitFrequency } from "../enums/habit-frequency.enum";

describe("HabitSchedule", () => {
  it.each([0, 8])("rejects out-of-range weekday %s", (dayOfWeek) => {
    expect(() =>
      HabitSchedule.create({
        id: "schedule-id",
        habitId: "habit-id",
        dayOfWeek,
        timeOfDay: null,
      }),
    ).toThrow("between 1 and 7");
  });

  it("accepts a null weekday for schedules without a weekday", () => {
    expect(
      HabitSchedule.create({
        id: "schedule-id",
        habitId: "habit-id",
        dayOfWeek: null,
        timeOfDay: "08:00:00",
      }).state.dayOfWeek,
    ).toBeNull();
  });
  it("rejects a weekly schedule without a weekday", () => {
    const schedule = HabitSchedule.create({
      id: "schedule-id",
      habitId: "habit-id",
      dayOfWeek: null,
      timeOfDay: "08:00",
    });
    expect(() =>
      HabitSchedule.validateForFrequency(
        HabitFrequency.WEEKLY,
        [schedule],
      ),
    ).toThrow("require a day");
  });
});
