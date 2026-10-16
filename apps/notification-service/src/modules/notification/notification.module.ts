import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { PrismaModule } from "../../prisma.module";
import { PrismaService } from "../../prisma.service";
import { PrismaNotificationDispatchRepository } from "../../persistence/notification-dispatch.persistence";
import {
  NOTIFICATION_DISPATCH,
  type NotificationDispatchRepository,
} from "./application/repositories/notification-dispatch.repository";
import { AcceptReminderUseCase } from "./application/use-cases/accept-reminder.use-case";
@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: NOTIFICATION_DISPATCH,
      inject: [PrismaService, ConfigService],
      useFactory: (db: PrismaService, c: ConfigService) =>
        new PrismaNotificationDispatchRepository(db, {
          leaseMs: c.getOrThrow<number>("NOTIFICATION_LEASE_MS"),
          retryMs: c.getOrThrow<number>("NOTIFICATION_RETRY_MS"),
          maxAttempts: c.getOrThrow<number>("NOTIFICATION_MAX_ATTEMPTS"),
          maxTargets: c.getOrThrow<number>("NOTIFICATION_MAX_TARGETS"),
        }),
    },
    {
      provide: AcceptReminderUseCase,
      inject: [NOTIFICATION_DISPATCH, ConfigService],
      useFactory: (
        repository: NotificationDispatchRepository,
        c: ConfigService,
      ) =>
        new AcceptReminderUseCase(
          repository,
          {
            titleChars: c.getOrThrow<number>("NOTIFICATION_TITLE_MAX_CHARS"),
            bodyChars: c.getOrThrow<number>("NOTIFICATION_BODY_MAX_CHARS"),
            dataBytes: c.getOrThrow<number>("NOTIFICATION_DATA_MAX_BYTES"),
          },
          randomUUID,
        ),
    },
  ],
})
export class NotificationModule {}
