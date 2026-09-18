import { NotFoundException } from "@nestjs/common";
import type {
  HabitLogRepository,
  HabitRepository,
} from "../../../application/repositories/productivity.repositories";
import { Habit } from "../domain/entities/habit.entity";
import { HabitFrequency } from "../domain/enums/habit-frequency.enum";
import {
  CreateHabit,
  GetHabit,
  LogHabitCompletion,
  PauseHabit,
  ResumeHabit,
} from "./habit.use-cases";

describe("Habit use cases", () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const habit = () =>
    Habit.create({
      id: "10000000-0000-4000-8000-000000000001",
      userId,
      name: "Exercise",
      frequencyType: HabitFrequency.DAILY,
      timezone: "Asia/Ho_Chi_Minh",
      startDate: "2026-09-01",
    });
  const habitRepository = (found = true) =>
    ({
      findByIdAndUserId: jest.fn().mockResolvedValue(
        found ? { habit: habit(), schedules: [] } : null,
      ),
      findPageByUserId: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
    }) as jest.Mocked<HabitRepository>;
  const logRepository = () =>
    ({
      findByIdAndHabitId: jest.fn(),
      findPageByHabitId: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
    }) as jest.Mocked<HabitLogRepository>;

  it("creates an owned weekly habit with validated schedules", async () => {
    const repository = habitRepository(false);
    const result = await new CreateHabit(repository).execute(userId, {
      name: "Gym",
      frequencyType: HabitFrequency.WEEKLY,
      timezone: "Asia/Ho_Chi_Minh",
      startDate: "2026-09-01",
      schedules: [{ dayOfWeek: 2, timeOfDay: "07:30" }],
    });
    expect(result.userId).toBe(userId);
    expect(result.schedules[0]).toMatchObject({
      dayOfWeek: 2,
      timeOfDay: "07:30",
    });
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it("hides another user's habit as not found", async () => {
    const repository = habitRepository(false);
    await expect(new GetHabit(repository).execute(userId, "habit-id"))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(repository.findByIdAndUserId).toHaveBeenCalledWith(
      "habit-id",
      userId,
    );
  });

  it("pauses and resumes through domain lifecycle behavior", async () => {
    const repository = habitRepository();
    expect(
      (await new PauseHabit(repository).execute(userId, habit().state.id))
        .isActive,
    ).toBe(false);
    expect(
      (await new ResumeHabit(repository).execute(userId, habit().state.id))
        .isActive,
    ).toBe(true);
  });

  it("logs a completion using the authenticated owner", async () => {
    const habits = habitRepository();
    const logs = logRepository();
    const result = await new LogHabitCompletion(habits, logs).execute(
      userId,
      habit().state.id,
      { logDate: "2026-09-16", completedCount: 2 },
    );
    expect(result).toMatchObject({ userId, completedCount: 2 });
    expect(logs.save).toHaveBeenCalledTimes(1);
  });

  it("does not log a paused habit", async () => {
    const paused = habit();
    paused.deactivate();
    const habits = habitRepository();
    habits.findByIdAndUserId.mockResolvedValue({ habit: paused, schedules: [] });
    await expect(
      new LogHabitCompletion(habits, logRepository()).execute(
        userId,
        paused.state.id,
        { logDate: "2026-09-16" },
      ),
    ).rejects.toThrow("Inactive habit");
  });
});
