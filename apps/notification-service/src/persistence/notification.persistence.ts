import type {
  Notification as NotificationRecord,
  NotificationDelivery as DeliveryRecord,
} from "../../generated/client";
import { Prisma } from "../../generated/client";
import { PrismaService } from "../prisma.service";
import type {
  NotificationRepository,
  NotificationDeliveryRepository,
} from "../application/repositories/notification.repositories";
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
  async findByUserId(userId: string) {
    return (
      await this.db.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      })
    ).map(NotificationMapper.toDomain);
  }
  async save(e: Notification) {
    const data = NotificationMapper.toPersistence(e);
    await this.db.notification.upsert({
      where: { id: e.state.id },
      create: data,
      update: data,
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
    await this.db.notificationDelivery.upsert({
      where: { id: e.state.id },
      create: data,
      update: data,
    });
  }
}
