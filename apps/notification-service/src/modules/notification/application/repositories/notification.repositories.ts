import type { UUID } from "@lifehelper/shared-types";
import type { Notification } from "../../domain/entities/notification.entity";
import type { NotificationDelivery } from "../../domain/entities/notification-delivery.entity";
export interface NotificationRepository {
  findById(id: UUID): Promise<Notification | null>;
  findByIdAndUserId(id: UUID, userId: UUID): Promise<Notification | null>;
  markRead(id: UUID, userId: UUID): Promise<boolean>;
  findByUserId(
    userId: UUID,
    limit?: number,
    before?: { createdAt: Date; id: UUID },
  ): Promise<Notification[]>;
  save(entity: Notification): Promise<void>;
}
export interface NotificationDeliveryRepository {
  findByNotificationId(id: UUID): Promise<NotificationDelivery[]>;
  save(entity: NotificationDelivery): Promise<void>;
}
