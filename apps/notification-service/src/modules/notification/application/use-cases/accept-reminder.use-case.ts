import type { NotificationDispatchRepository } from "../repositories/notification-dispatch.repository";
import { Notification } from "../../domain/entities/notification.entity";
import { NotificationType } from "../../domain/enums/notification.enums";
import {
  validateUuid,
  type NotificationContentLimits,
} from "../../domain/notification-policy";
import { NotificationDomainError } from "../../domain/errors/notification-domain.error";
import type { JsonValue } from "@lifehelper/shared-types";
export interface ReminderIntake {
  userId: string;
  sourceEventId: string;
  sourceReminderId: string;
  dispatchVersion: number;
  title: string;
  body: string;
  data?: JsonValue;
  eligibleAt: Date;
  expiresAt: Date;
}
export class AcceptReminderUseCase {
  constructor(
    private readonly repository: NotificationDispatchRepository,
    private readonly limits: NotificationContentLimits,
    private readonly newId: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}
  execute(consumer: string, input: ReminderIntake) {
    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(consumer))
      throw new NotificationDomainError("Invalid inbox consumer");
    validateUuid(input.userId);
    return this.repository.accept(
      consumer,
      Notification.create(
        {
          ...input,
          userId: input.userId.toLowerCase(),
          sourceEventId: input.sourceEventId.toLowerCase(),
          id: this.newId(),
          type: NotificationType.REMINDER,
          createdAt: this.now(),
        },
        this.limits,
      ),
    );
  }
}
