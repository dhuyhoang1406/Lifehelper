import type { UUID } from "@lifehelper/shared-types";
import type { Notification } from "../../domain/entities/notification.entity";
import type { NotificationDelivery } from "../../domain/entities/notification-delivery.entity";
export interface NotificationRepository {
  findById(id: UUID): Promise<Notification | null>;
  findByUserId(userId: UUID): Promise<Notification[]>;
  save(entity: Notification): Promise<void>;
}
export interface NotificationDeliveryRepository {
  findByNotificationId(id: UUID): Promise<NotificationDelivery[]>;
  save(entity: NotificationDelivery): Promise<void>;
}
