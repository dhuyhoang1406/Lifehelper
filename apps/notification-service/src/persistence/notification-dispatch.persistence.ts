import { randomUUID } from "node:crypto";
import {
  Prisma,
  type Notification as RecordNotification,
} from "../../generated/client";
import { PrismaService } from "../prisma.service";
import type {
  NotificationDispatchRepository,
  DispatchLease,
  DeliveryOutcome,
} from "../modules/notification/application/repositories/notification-dispatch.repository";
import type { Notification } from "../modules/notification/domain/entities/notification.entity";
import { NotificationDomainError } from "../modules/notification/domain/errors/notification-domain.error";
import {
  aggregateDeliveryState,
  safeReason,
  validateUuid,
  type DeliveryReason,
  type SuppressionReason,
} from "../modules/notification/domain/notification-policy";
import { DeliveryStatus } from "../modules/notification/domain/enums/notification.enums";
import { NotificationMapper } from "./notification.persistence";

type Tx = Prisma.TransactionClient;
export interface DispatchSettings {
  leaseMs: number;
  retryMs: number;
  maxAttempts: number;
  maxTargets: number;
}
class LeaseLost extends Error {}
export class PrismaNotificationDispatchRepository implements NotificationDispatchRepository {
  constructor(
    private readonly db: PrismaService,
    private readonly settings: DispatchSettings,
  ) {
    if (
      ![
        settings.leaseMs,
        settings.retryMs,
        settings.maxAttempts,
        settings.maxTargets,
      ].every((v) => Number.isSafeInteger(v) && v > 0) ||
      settings.leaseMs > 300000 ||
      settings.retryMs > 3600000 ||
      settings.maxTargets > 1000 ||
      settings.maxAttempts > 100
    )
      throw new Error("Invalid notification dispatch settings");
  }
  private async clock(tx: Tx): Promise<Date> {
    return (
      await tx.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() AS at`
    )[0].at;
  }
  private async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM notifications WHERE id = ${id}::uuid FOR UPDATE`;
  }
  async accept(consumer: string, notification: Notification) {
    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(consumer))
      throw new NotificationDomainError("Invalid inbox consumer");
    const p = notification.state;
    if (
      !p.sourceEventId ||
      !p.sourceReminderId ||
      !p.dispatchVersion ||
      !p.expiresAt ||
      p.status !== "PENDING"
    )
      throw new NotificationDomainError(
        "Reminder dispatch identity is required",
      );
    return this.db.$transaction(async (tx) => {
      const created = await tx.notification.createMany({
        data: [NotificationMapper.toPersistence(notification)],
        skipDuplicates: true,
      });
      const existing = await tx.notification.findMany({
        where: {
          OR: [
            { sourceEventId: p.sourceEventId },
            {
              sourceReminderId: p.sourceReminderId,
              dispatchVersion: p.dispatchVersion,
            },
          ],
        },
      });
      if (
        existing.length !== 1 ||
        existing[0].userId !== p.userId ||
        existing[0].sourceReminderId !== p.sourceReminderId ||
        existing[0].dispatchVersion !== p.dispatchVersion
      )
        throw new NotificationDomainError(
          "Conflicting notification dispatch identity",
        );
      const id = existing[0].id;
      await this.lock(tx, id);
      await tx.notificationDispatchWork.upsert({
        where: { notificationId: id },
        create: { notificationId: id, nextAttemptAt: existing[0].eligibleAt },
        update: {},
      });
      await tx.notificationInboxRecord.createMany({
        data: [{ consumer, eventId: p.sourceEventId!, notificationId: id }],
        skipDuplicates: true,
      });
      const receipt = await tx.notificationInboxRecord.findUniqueOrThrow({
        where: { consumer_eventId: { consumer, eventId: p.sourceEventId! } },
      });
      if (receipt.notificationId !== id)
        throw new NotificationDomainError(
          "Conflicting notification event identity",
        );
      return { notificationId: id, created: created.count === 1 };
    });
  }
  async claim(owner: string): Promise<DispatchLease | null> {
    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(owner))
      throw new NotificationDomainError("Invalid lease owner");
    return this.db.$transaction(async (tx) => {
      // Every writer locks the notification before touching its work/deliveries.
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT n.id FROM notifications n JOIN notification_dispatch_work w ON w.notification_id = n.id
        WHERE w.completed_at IS NULL AND w.next_attempt_at <= clock_timestamp()
          AND (w.lease_expires_at IS NULL OR w.lease_expires_at <= clock_timestamp())
        ORDER BY w.next_attempt_at, n.id LIMIT 1 FOR UPDATE OF n SKIP LOCKED`;
      if (!rows.length) return null;
      const id = rows[0].id;
      const n = await tx.notification.findUniqueOrThrow({ where: { id } });
      const work = await tx.notificationDispatchWork.findUniqueOrThrow({
        where: { notificationId: id },
      });
      const now = await this.clock(tx);
      // The join used an earlier READ COMMITTED snapshot: recheck work under the parent lock.
      if (
        work.completedAt ||
        work.nextAttemptAt > now ||
        (work.leaseExpiresAt && work.leaseExpiresAt > now)
      )
        return null;
      if (n.suppressionReason || (n.expiresAt && n.expiresAt <= now)) {
        await this.suppressLocked(
          tx,
          n,
          (n.suppressionReason ?? "DISPATCH_EXPIRED") as SuppressionReason,
          now,
        );
        return null;
      }
      if (work.attemptCount >= this.settings.maxAttempts) {
        await tx.notificationDelivery.updateMany({
          where: { notificationId: id, status: "PENDING" },
          data: {
            status: "FAILED",
            failedAt: now,
            lastError: "DISPATCH_ATTEMPTS_EXHAUSTED",
            updatedAt: now,
          },
        });
        await this.aggregate(tx, id, now, "DISPATCH_ATTEMPTS_EXHAUSTED");
        await tx.notificationDispatchWork.update({
          where: { notificationId: id },
          data: {
            completedAt: now,
            leaseOwner: null,
            leaseExpiresAt: null,
            lastError: "DISPATCH_ATTEMPTS_EXHAUSTED",
          },
        });
        return null;
      }
      const claimed = await tx.notificationDispatchWork.update({
        where: { notificationId: id },
        data: {
          leaseOwner: owner,
          leaseToken: { increment: 1 },
          attemptCount: { increment: 1 },
          leaseExpiresAt: new Date(now.getTime() + this.settings.leaseMs),
        },
      });
      await tx.notification.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "PROCESSING" },
      });
      return { notificationId: id, owner, token: claimed.leaseToken };
    });
  }
  private async withLease(
    lease: DispatchLease,
    action: (tx: Tx, now: Date) => Promise<void>,
  ) {
    try {
      return await this.db.$transaction(async (tx) => {
        await this.lock(tx, lease.notificationId);
        const work = await tx.notificationDispatchWork.findUnique({
          where: { notificationId: lease.notificationId },
        });
        const now = await this.clock(tx);
        if (
          !work ||
          work.completedAt ||
          work.leaseOwner !== lease.owner ||
          work.leaseToken !== lease.token ||
          !work.leaseExpiresAt ||
          work.leaseExpiresAt <= now
        )
          return false;
        const n = await tx.notification.findUniqueOrThrow({
          where: { id: lease.notificationId },
        });
        if (n.expiresAt && n.expiresAt <= now) {
          await this.suppressLocked(tx, n, "DISPATCH_EXPIRED", now);
          return false;
        }
        await action(tx, now);
        // Roll back writes if the lease expired while this transaction was working.
        if (work.leaseExpiresAt <= (await this.clock(tx)))
          throw new LeaseLost();
        return true;
      });
    } catch (error) {
      if (error instanceof LeaseLost) return false;
      throw error;
    }
  }
  async resolveTargets(lease: DispatchLease, deviceSessionIds: string[]) {
    if (deviceSessionIds.length > this.settings.maxTargets)
      throw new NotificationDomainError("Too many notification targets");
    const ids = [
      ...new Set(
        deviceSessionIds.map((id) => {
          validateUuid(id);
          return id.toLowerCase();
        }),
      ),
    ];
    if (ids.length > this.settings.maxTargets)
      throw new NotificationDomainError("Too many notification targets");
    return this.withLease(lease, async (tx, now) => {
      const work = await tx.notificationDispatchWork.findUniqueOrThrow({
        where: { notificationId: lease.notificationId },
      });
      if (work.targetsResolvedAt) return; // Target snapshot is immutable for this dispatch.
      await tx.notificationDelivery.createMany({
        data: ids.map((deviceSessionId) => ({
          id: randomUUID(),
          notificationId: lease.notificationId,
          deviceSessionId,
          provider: "FCM" as const,
          status: "PENDING" as const,
          createdAt: now,
          updatedAt: now,
          nextAttemptAt: now,
        })),
        skipDuplicates: true,
      });
      await tx.notificationDispatchWork.update({
        where: { notificationId: lease.notificationId },
        data: { targetsResolvedAt: now },
      });
      if (!ids.length) {
        await this.aggregate(tx, lease.notificationId, now);
        await tx.notificationDispatchWork.update({
          where: { notificationId: lease.notificationId },
          data: {
            completedAt: now,
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
      }
    });
  }
  async settle(
    lease: DispatchLease,
    outcomes: DeliveryOutcome[],
    retryReason: DeliveryReason = "PROVIDER_UNAVAILABLE",
  ) {
    safeReason(retryReason);
    if (outcomes.length > this.settings.maxTargets)
      throw new NotificationDomainError("Too many delivery outcomes");
    if (new Set(outcomes.map((o) => o.deliveryId)).size !== outcomes.length)
      throw new NotificationDomainError("Duplicate delivery outcome");
    return this.withLease(lease, async (tx, now) => {
      for (const o of outcomes) {
        validateUuid(o.deliveryId);
        if (!["SENT", "FAILED", "SKIPPED", "RETRY"].includes(o.result))
          throw new NotificationDomainError("Invalid delivery outcome");
        if (
          o.result === "SENT" &&
          (!o.providerMessageId?.trim() || o.providerMessageId.length > 255)
        )
          throw new NotificationDomainError(
            "Provider message reference is required",
          );
        const reason =
          o.result === "SENT" ? null : safeReason(o.reason ?? retryReason);
        const updated = await tx.notificationDelivery.updateMany({
          where: {
            id: o.deliveryId,
            notificationId: lease.notificationId,
            status: "PENDING",
          },
          data: {
            status: o.result === "RETRY" ? "PENDING" : o.result,
            attemptCount: o.result === "SKIPPED" ? undefined : { increment: 1 },
            providerMessageId:
              o.result === "SENT" ? o.providerMessageId : undefined,
            lastError: reason,
            updatedAt: now,
            sentAt: o.result === "SENT" ? now : undefined,
            failedAt: o.result === "FAILED" ? now : undefined,
            skippedAt: o.result === "SKIPPED" ? now : undefined,
            nextAttemptAt: new Date(now.getTime() + this.settings.retryMs),
          },
        });
        if (!updated.count)
          throw new NotificationDomainError(
            "Delivery is not pending in this dispatch",
          );
      }
      await this.aggregate(tx, lease.notificationId, now);
      const work = await tx.notificationDispatchWork.findUniqueOrThrow({
        where: { notificationId: lease.notificationId },
      });
      const pending = await tx.notificationDelivery.count({
        where: { notificationId: lease.notificationId, status: "PENDING" },
      });
      const complete = work.targetsResolvedAt !== null && pending === 0;
      await tx.notificationDispatchWork.update({
        where: { notificationId: lease.notificationId },
        data: {
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: complete ? now : null,
          nextAttemptAt: new Date(now.getTime() + this.settings.retryMs),
          lastError: complete ? null : retryReason,
        },
      });
    });
  }
  private async aggregate(
    tx: Tx,
    id: string,
    now: Date,
    reason: DeliveryReason | null = null,
  ) {
    const work = await tx.notificationDispatchWork.findUniqueOrThrow({
      where: { notificationId: id },
    });
    const deliveries = await tx.notificationDelivery.findMany({
      where: { notificationId: id },
    });
    const state = aggregateDeliveryState(
      deliveries.map((d) => ({
        status: d.status as DeliveryStatus,
        sentAt: d.sentAt,
      })),
      work.targetsResolvedAt !== null,
      reason,
    );
    await tx.notification.update({
      where: { id },
      data: {
        status: state.status,
        sentAt: state.sentAt,
        failureReason: state.reason,
        failedAt: state.status === "FAILED" ? now : null,
      },
    });
  }
  private async suppressLocked(
    tx: Tx,
    n: RecordNotification,
    reason: SuppressionReason,
    now: Date,
  ) {
    await tx.notificationDelivery.updateMany({
      where: { notificationId: n.id, status: "PENDING" },
      data: {
        status: "SKIPPED",
        skippedAt: now,
        updatedAt: now,
        lastError: reason,
      },
    });
    await tx.notification.update({
      where: { id: n.id },
      data: {
        suppressedAt: n.suppressedAt ?? now,
        suppressionReason: n.suppressionReason ?? reason,
      },
    });
    await this.aggregate(tx, n.id, now, reason);
    await tx.notificationDispatchWork.update({
      where: { notificationId: n.id },
      data: {
        completedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        leaseToken: { increment: 1 },
        lastError: reason,
      },
    });
  }
  async suppress(
    notificationId: string,
    userId: string,
    reason: SuppressionReason,
  ) {
    if (
      !["DISPATCH_CANCELLED", "DISPATCH_STALE", "DISPATCH_EXPIRED"].includes(
        reason,
      )
    )
      throw new NotificationDomainError("Invalid suppression reason");
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, notificationId);
      const n = await tx.notification.findFirst({
        where: { id: notificationId, userId, work: { isNot: null } },
      });
      if (!n) return false;
      if (n.suppressedAt) return true;
      await this.suppressLocked(tx, n, reason, await this.clock(tx));
      return true;
    });
  }
}
