import type {
  Notification as NotificationRecord,
  NotificationDelivery as DeliveryRecord,
} from "../../generated/client";
import { Prisma } from "../../generated/client";
import { PrismaService } from "../prisma.service";
import type {
  NotificationRepository,
  NotificationDeliveryRepository,
} from "../modules/notification/application/repositories/notification.repositories";
import { Notification } from "../modules/notification/domain/entities/notification.entity";
import { NotificationDelivery } from "../modules/notification/domain/entities/notification-delivery.entity";
import {
  DeliveryStatus,
  NotificationProvider,
  NotificationStatus,
  NotificationType,
} from "../modules/notification/domain/enums/notification.enums";
import type { JsonValue } from "@lifehelper/shared-types";
export const NotificationMapper = {
  toDomain: (r: NotificationRecord) =>
    Notification.restore({
      ...r,
      suppressionReason: r.suppressionReason as
        | import("../modules/notification/domain/notification-policy").SuppressionReason
        | null,
      failureReason: r.failureReason as
        | import("../modules/notification/domain/notification-policy").DeliveryReason
        | null,
      type: r.type as NotificationType,
      status: r.status as NotificationStatus,
      data: r.data as JsonValue | null,
    }),
  toPersistence: (e: Notification) => ({
    ...e.state,
    data:
      e.state.data === null
        ? Prisma.DbNull
        : (e.state.data as Prisma.InputJsonValue),
  }),
};
export const NotificationDeliveryMapper = {
  toDomain: (r: DeliveryRecord) =>
    NotificationDelivery.restore({
      ...r,
      provider: r.provider as NotificationProvider,
      status: r.status as DeliveryStatus,
    }),
  toPersistence: (e: NotificationDelivery) => e.state,
};
export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private readonly db: PrismaService) {}
  async findById(id: string) {
    const r = await this.db.notification.findUnique({ where: { id } });
    return r ? NotificationMapper.toDomain(r) : null;
  }
  async findByIdAndUserId(id: string, userId: string) {
    const r = await this.db.notification.findFirst({ where: { id, userId } });
    return r ? NotificationMapper.toDomain(r) : null;
  }
  async markRead(id: string, userId: string) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE notifications SET read_at = COALESCE(read_at, clock_timestamp()) WHERE id = ${id}::uuid AND user_id = ${userId}::uuid`;
      return (await tx.notification.count({ where: { id, userId } })) === 1;
    });
  }
  async findByUserId(
    userId: string,
    limit = 20,
    before?: { createdAt: Date; id: string },
  ) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Invalid notification page size");
    return (
      await this.db.notification.findMany({
        where: {
          userId,
          ...(before
            ? {
                OR: [
                  { createdAt: { lt: before.createdAt } },
                  { createdAt: before.createdAt, id: { lt: before.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      })
    ).map(NotificationMapper.toDomain);
  }
  async save(e: Notification) {
    const data = NotificationMapper.toPersistence(e);
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM notifications WHERE id = ${e.state.id}::uuid FOR UPDATE`;
      const existing = await tx.notification.findUnique({
        where: { id: e.state.id },
        include: { work: true },
      });
      if (existing?.work || (existing && existing.userId !== e.state.userId))
        throw new Error("Managed notification or immutable owner");
      if (existing)
        await tx.notification.update({ where: { id: e.state.id }, data });
      else await tx.notification.create({ data });
    });
  }
}
export class PrismaNotificationDeliveryRepository implements NotificationDeliveryRepository {
  constructor(private readonly db: PrismaService) {}
  async findByNotificationId(notificationId: string) {
    return (
      await this.db.notificationDelivery.findMany({
        where: { notificationId },
        orderBy: { createdAt: "asc" },
      })
    ).map(NotificationDeliveryMapper.toDomain);
  }
  async save(e: NotificationDelivery) {
    const data = NotificationDeliveryMapper.toPersistence(e);
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM notifications WHERE id = ${e.state.notificationId}::uuid FOR UPDATE`;
      const managed = await tx.notificationDispatchWork.count({
        where: { notificationId: e.state.notificationId },
      });
      const existing = await tx.notificationDelivery.findUnique({
        where: { id: e.state.id },
      });
      if (
        managed ||
        (existing &&
          (existing.notificationId !== e.state.notificationId ||
            existing.deviceSessionId !== e.state.deviceSessionId))
      )
        throw new Error("Managed delivery or immutable target");
      if (existing)
        await tx.notificationDelivery.update({
          where: { id: e.state.id },
          data,
        });
      else await tx.notificationDelivery.create({ data });
    });
  }
}
