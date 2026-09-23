import { NotFoundException } from "@nestjs/common";
import type {
  HabitLogRepository,
  HabitRepository,
} from "../../../application/repositories/productivity.repositories";
import { Habit } from "../domain/entities/habit.entity";
import { HabitLog } from "../domain/entities/habit-log.entity";
import { HabitSchedule } from "../domain/entities/habit-schedule.entity";
import { HabitFrequency } from "../domain/enums/habit-frequency.enum";
import {
  CreateHabit,
  GetHabit,
  GetHabitLogs,
  LogHabitCompletion,
  PauseHabit,
  ResumeHabit,
  UpdateHabit,
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
      findByIdAndUserId: jest
        .fn()
        .mockResolvedValue(found ? { habit: habit(), schedules: [] } : null),
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
    await expect(
      new GetHabit(repository).execute(userId, "habit-id"),
    ).rejects.toBeInstanceOf(NotFoundException);
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

  it("returns habit log state instead of exposing domain entities", async () => {
    const habits = habitRepository();
    const logs = logRepository();
    const log = HabitLog.create({
      id: "log-1",
      habitId: habit().state.id,
      userId,
      logDate: "2026-09-16",
    });
    logs.findPageByHabitId.mockResolvedValue({
      items: [log],
      total: 1,
      page: 1,
      limit: 20,
    });

    await expect(
      new GetHabitLogs(habits, logs).execute(userId, habit().state.id, {
        page: 1,
        limit: 20,
      }),
    ).resolves.toEqual({
      items: [log.state],
      total: 1,
      page: 1,
      limit: 20,
    });
  });

  it("does not log a paused habit", async () => {
    const paused = habit();
    paused.deactivate();
    const habits = habitRepository();
    habits.findByIdAndUserId.mockResolvedValue({
      habit: paused,
      schedules: [],
    });
    await expect(
      new LogHabitCompletion(habits, logRepository()).execute(
        userId,
        paused.state.id,
        { logDate: "2026-09-16" },
      ),
    ).rejects.toThrow("Inactive habit");
  });

  describe("frequency transitions", () => {
    const weeklyAggregate = () => {
      const current = habit();
      current.update({ frequencyType: HabitFrequency.WEEKLY });
      return {
        habit: current,
        schedules: [
          HabitSchedule.create({
            id: "schedule-id",
            habitId: current.state.id,
            dayOfWeek: 2,
            timeOfDay: "07:30",
          }),
        ],
      };
    };

    it("rejects weekly-to-daily without compatible schedules and does not save", async () => {
      const repository = habitRepository();
      const aggregate = weeklyAggregate();
      repository.findByIdAndUserId.mockResolvedValue(aggregate);
      await expect(
        new UpdateHabit(repository).execute(userId, aggregate.habit.state.id, {
          frequencyType: HabitFrequency.DAILY,
        }),
      ).rejects.toThrow("provide schedules: []");
      expect(repository.save).not.toHaveBeenCalled();
    });

    it("clears schedules explicitly when changing weekly-to-daily", async () => {
      const repository = habitRepository();
      const aggregate = weeklyAggregate();
      repository.findByIdAndUserId.mockResolvedValue(aggregate);
      const result = await new UpdateHabit(repository).execute(
        userId,
        aggregate.habit.state.id,
        { frequencyType: HabitFrequency.DAILY, schedules: [] },
      );
      expect(result.frequencyType).toBe(HabitFrequency.DAILY);
      expect(result.schedules).toEqual([]);
      expect(repository.save).toHaveBeenCalledWith(aggregate.habit, []);
    });

    it("preserves weekly schedules when updating only the name", async () => {
      const repository = habitRepository();
      const aggregate = weeklyAggregate();
      repository.findByIdAndUserId.mockResolvedValue(aggregate);
      const result = await new UpdateHabit(repository).execute(
        userId,
        aggregate.habit.state.id,
        { name: "New name" },
      );
      expect(result.schedules).toEqual(
        aggregate.schedules.map(({ state }) => state),
      );
      expect(repository.save).toHaveBeenCalledWith(aggregate.habit, undefined);
    });

    it("rejects daily-to-weekly without weekday schedules", async () => {
      const repository = habitRepository();
      await expect(
        new UpdateHabit(repository).execute(userId, habit().state.id, {
          frequencyType: HabitFrequency.WEEKLY,
        }),
      ).rejects.toThrow("provide schedules with a day of week");
      expect(repository.save).not.toHaveBeenCalled();
    });

    it("accepts daily-to-weekly with explicit weekday schedules", async () => {
      const repository = habitRepository();
      const result = await new UpdateHabit(repository).execute(
        userId,
        habit().state.id,
        {
          frequencyType: HabitFrequency.WEEKLY,
          schedules: [{ dayOfWeek: 3, timeOfDay: "08:00" }],
        },
      );
      expect(result.frequencyType).toBe(HabitFrequency.WEEKLY);
      expect(result.schedules[0].dayOfWeek).toBe(3);
    });
  });
});
