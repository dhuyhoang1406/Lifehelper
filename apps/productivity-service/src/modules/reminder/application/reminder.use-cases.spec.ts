import { NotFoundException } from "@nestjs/common";
import type { ReminderRepository } from "../../../application/repositories/productivity.repositories";
import { Reminder } from "../domain/entities/reminder.entity";
import { ReminderResourceType } from "../domain/enums/reminder.enums";
import {
  CancelReminder,
  CreateReminder,
  DeleteReminder,
  GetReminder,
  ListReminders,
  UpdateReminder,
} from "./reminder.use-cases";

describe("Reminder use cases", () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const current = () =>
    Reminder.create({
      id: "10000000-0000-4000-8000-000000000001",
      userId,
      resourceType: ReminderResourceType.CUSTOM,
      title: "Pay bill",
      remindAt: new Date("2026-09-23T02:00:00Z"),
      timezone: "Asia/Ho_Chi_Minh",
    });
  const repo = (found = true) =>
    ({
      findByIdAndUserId: jest.fn().mockResolvedValue(found ? current() : null),
      findPendingBefore: jest.fn().mockResolvedValue([]),
      findPageByUserId: jest
        .fn()
        .mockResolvedValue({
          items: [current()],
          total: 1,
          page: 1,
          limit: 20,
        }),
      save: jest.fn(),
      delete: jest.fn(),
      resourceBelongsToUser: jest.fn().mockResolvedValue(true),
    }) as jest.Mocked<ReminderRepository>;
  it("creates only for authenticated owner and verifies linked resource", async () => {
    const repository = repo();
    const result = await new CreateReminder(repository).execute(userId, {
      resourceType: ReminderResourceType.TASK,
      resourceId: "20000000-0000-4000-8000-000000000001",
      title: "Task",
      remindAt: new Date("2026-09-23T02:00:00Z"),
      timezone: "UTC",
    });
    expect(result.userId).toBe(userId);
    expect(repository.resourceBelongsToUser).toHaveBeenCalledWith(
      ReminderResourceType.TASK,
      "20000000-0000-4000-8000-000000000001",
      userId,
    );
    repository.resourceBelongsToUser.mockResolvedValue(false);
    await expect(
      new CreateReminder(repository).execute(userId, {
        resourceType: ReminderResourceType.HABIT,
        resourceId: "missing",
        title: "Habit",
        remindAt: new Date(),
        timezone: "UTC",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it("scopes get, update, cancel, and delete by owner", async () => {
    const repository = repo(false);
    await expect(
      new GetReminder(repository).execute(userId, "missing"),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      new UpdateReminder(repository).execute(userId, "missing", {
        title: "New",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      new CancelReminder(repository).execute(userId, "missing"),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      new DeleteReminder(repository).execute(userId, "missing"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.delete).not.toHaveBeenCalled();
  });
  it("lists a bounded page and validates date range", async () => {
    const repository = repo();
    const useCase = new ListReminders(repository);
    const result = await useCase.execute(userId, { page: 1, limit: 20 });
    expect(result.items[0].title).toBe("Pay bill");
    await expect(
      useCase.execute(userId, {
        page: 1,
        limit: 20,
        from: new Date("2026-10-01"),
        to: new Date("2026-09-01"),
      }),
    ).rejects.toThrow("range");
  });
});
