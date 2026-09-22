import { randomUUID } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ReminderRepository } from "../../../application/repositories/productivity.repositories";
import { REMINDER_REPOSITORY } from "../../../application/repositories/productivity.repositories";
import { Reminder } from "../domain/entities/reminder.entity";
import {
  ReminderResourceType,
  ReminderStatus,
} from "../domain/enums/reminder.enums";
import { ReminderDomainError } from "../domain/errors/reminder-domain.error";

export interface ReminderInput {
  resourceType: ReminderResourceType;
  resourceId?: string | null;
  title: string;
  remindAt: Date;
  timezone: string;
}
export type ReminderUpdate = Partial<ReminderInput>;

async function validateReference(
  repo: ReminderRepository,
  userId: string,
  type: ReminderResourceType,
  id: string | null,
) {
  if (
    type !== ReminderResourceType.CUSTOM &&
    id &&
    !(await repo.resourceBelongsToUser(type, id, userId))
  )
    throw new NotFoundException("Linked resource not found");
}
async function owned(repo: ReminderRepository, userId: string, id: string) {
  const reminder = await repo.findByIdAndUserId(id, userId);
  if (!reminder) throw new NotFoundException("Reminder not found");
  return reminder;
}

@Injectable()
export class CreateReminder {
  constructor(
    @Inject(REMINDER_REPOSITORY) private readonly reminders: ReminderRepository,
  ) {}
  async execute(userId: string, input: ReminderInput) {
    const reminder = Reminder.create({ ...input, id: randomUUID(), userId });
    await validateReference(
      this.reminders,
      userId,
      reminder.state.resourceType,
      reminder.state.resourceId,
    );
    await this.reminders.save(reminder);
    return reminder.state;
  }
}
@Injectable()
export class GetReminder {
  constructor(
    @Inject(REMINDER_REPOSITORY) private readonly reminders: ReminderRepository,
  ) {}
  async execute(userId: string, id: string) {
    return (await owned(this.reminders, userId, id)).state;
  }
}
@Injectable()
export class ListReminders {
  constructor(
    @Inject(REMINDER_REPOSITORY) private readonly reminders: ReminderRepository,
  ) {}
  async execute(
    userId: string,
    query: {
      status?: ReminderStatus;
      from?: Date;
      to?: Date;
      page: number;
      limit: number;
    },
  ) {
    if (query.from && query.to && query.to <= query.from)
      throw new ReminderDomainError("Reminder date range is invalid");
    const page = await this.reminders.findPageByUserId(userId, query);
    return { ...page, items: page.items.map((item) => item.state) };
  }
}
@Injectable()
export class UpdateReminder {
  constructor(
    @Inject(REMINDER_REPOSITORY) private readonly reminders: ReminderRepository,
  ) {}
  async execute(userId: string, id: string, input: ReminderUpdate) {
    const reminder = await owned(this.reminders, userId, id);
    reminder.update(input);
    await validateReference(
      this.reminders,
      userId,
      reminder.state.resourceType,
      reminder.state.resourceId,
    );
    await this.reminders.save(reminder);
    return reminder.state;
  }
}
@Injectable()
export class CancelReminder {
  constructor(
    @Inject(REMINDER_REPOSITORY) private readonly reminders: ReminderRepository,
  ) {}
  async execute(userId: string, id: string) {
    const reminder = await owned(this.reminders, userId, id);
    reminder.cancel();
    await this.reminders.save(reminder);
    return reminder.state;
  }
}
@Injectable()
export class DeleteReminder {
  constructor(
    @Inject(REMINDER_REPOSITORY) private readonly reminders: ReminderRepository,
  ) {}
  async execute(userId: string, id: string) {
    await owned(this.reminders, userId, id);
    await this.reminders.delete(id, userId);
  }
}
