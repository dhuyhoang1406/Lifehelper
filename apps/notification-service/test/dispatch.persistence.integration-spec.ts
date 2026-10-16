import { randomUUID } from "node:crypto";
import { PrismaService } from "../src/prisma.service";
import { PrismaNotificationDispatchRepository } from "../src/persistence/notification-dispatch.persistence";
import { PrismaNotificationRepository } from "../src/persistence/notification.persistence";
import { AcceptReminderUseCase } from "../src/modules/notification/application/use-cases/accept-reminder.use-case";
import type { DispatchLease } from "../src/modules/notification/application/repositories/notification-dispatch.repository";
const db = new PrismaService();
const owner = randomUUID(),
  foreign = randomUUID();
const settings = {
  leaseMs: 60000,
  retryMs: 1000,
  maxAttempts: 3,
  maxTargets: 5,
};
const repo = new PrismaNotificationDispatchRepository(db, settings);
const inbox = new PrismaNotificationRepository(db);
const intake = new AcceptReminderUseCase(
  repo,
  { titleChars: 255, bodyChars: 4096, dataBytes: 2048 },
  randomUUID,
);
function input() {
  return {
    userId: owner,
    sourceEventId: randomUUID(),
    sourceReminderId: randomUUID(),
    dispatchVersion: 1,
    title: "Reminder",
    body: "Safe content",
    eligibleAt: new Date(Date.now() - 1000),
    expiresAt: new Date(Date.now() + 3600000),
  };
}
async function create() {
  return intake.execute("reminder-due", input());
}
async function lease() {
  const value = await repo.claim("worker-a");
  expect(value).not.toBeNull();
  return value!;
}
async function expire(l: DispatchLease) {
  await db.notificationDispatchWork.update({
    where: { notificationId: l.notificationId },
    data: { leaseExpiresAt: new Date(0), nextAttemptAt: new Date(0) },
  });
}
async function due(id: string) {
  await db.notificationDispatchWork.update({
    where: { notificationId: id },
    data: { nextAttemptAt: new Date(0) },
  });
}
describe("Durable notification intake and dispatch (real PostgreSQL)", () => {
  beforeAll(async () => {
    if (!/(_test|_ci)$/.test(new URL(process.env.DATABASE_URL!).pathname))
      throw new Error("Dedicated test database required");
    await db.$connect();
  });
  beforeEach(async () => {
    const where = { notification: { userId: owner } };
    await db.notificationInboxRecord.deleteMany({ where });
    await db.notificationDelivery.deleteMany({ where });
    await db.notificationDispatchWork.deleteMany({ where });
    await db.notification.deleteMany({ where: { userId: owner } });
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  it("deduplicates concurrent event intake and distinct events for one occurrence", async () => {
    const i = input();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => intake.execute("reminder-due", i)),
    );
    expect(new Set(results.map((r) => r.notificationId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const second = await intake.execute("reminder-due", {
      ...i,
      sourceEventId: randomUUID(),
    });
    expect(second.notificationId).toBe(results[0].notificationId);
    expect(
      await db.notificationInboxRecord.count({
        where: { notificationId: second.notificationId },
      }),
    ).toBe(2);
    expect(
      await db.notificationDispatchWork.count({
        where: { notificationId: second.notificationId },
      }),
    ).toBe(1);
  });
  it("rejects identity conflicts without creating orphan work or receipts", async () => {
    const i = input();
    await intake.execute("reminder-due", i);
    await expect(
      intake.execute("reminder-due", { ...i, userId: foreign }),
    ).rejects.toThrow("Conflicting");
    expect(await db.notification.count({ where: { userId: foreign } })).toBe(0);
  });
  it("rolls back notification creation when receipt insertion fails", async () => {
    await db.$executeRawUnsafe(
      `CREATE FUNCTION reject_notification_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test receipt failure'; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER reject_receipt BEFORE INSERT ON notification_inbox_records FOR EACH ROW EXECUTE FUNCTION reject_notification_receipt()`,
    );
    try {
      const i = input();
      await expect(intake.execute("reminder-due", i)).rejects.toThrow();
      expect(
        await db.notification.count({
          where: { sourceEventId: i.sourceEventId },
        }),
      ).toBe(0);
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER reject_receipt ON notification_inbox_records`,
      );
      await db.$executeRawUnsafe(`DROP FUNCTION reject_notification_receipt()`);
    }
  });
  it("allows one concurrent claim and fences an expired worker", async () => {
    const n = await create();
    const claims = await Promise.all([repo.claim("a"), repo.claim("b")]);
    const l = claims.find(Boolean)!;
    expect(claims.filter(Boolean)).toHaveLength(1);
    await expire(l);
    const replacement = await lease();
    expect(replacement.token).toBeGreaterThan(l.token);
    expect(await repo.resolveTargets(l, [randomUUID()])).toBe(false);
    expect(await repo.resolveTargets(replacement, [])).toBe(true);
    expect((await inbox.findById(n.notificationId))?.state).toMatchObject({
      status: "FAILED",
      failureReason: "NO_ACTIVE_DEVICE",
    });
    expect(
      await db.notificationInboxRecord.count({
        where: { notificationId: n.notificationId },
      }),
    ).toBe(1);
  });
  it("retains SENT while another device retries and never retries a sent delivery", async () => {
    const n = await create();
    const l = await lease();
    await repo.resolveTargets(l, [randomUUID(), randomUUID()]);
    const ds = await db.notificationDelivery.findMany({
      where: { notificationId: n.notificationId },
      orderBy: { id: "asc" },
    });
    await repo.settle(l, [
      { deliveryId: ds[0].id, result: "SENT", providerMessageId: "fcm-id" },
      { deliveryId: ds[1].id, result: "RETRY", reason: "PROVIDER_TIMEOUT" },
    ]);
    expect((await inbox.findById(n.notificationId))?.state.status).toBe("SENT");
    expect(await repo.settle(l, [])).toBe(false);
    await due(n.notificationId);
    const next = await lease();
    await expect(
      repo.settle(next, [
        { deliveryId: ds[0].id, result: "FAILED", reason: "PROVIDER_TIMEOUT" },
      ]),
    ).rejects.toThrow("not pending");
    await repo.settle(next, [
      { deliveryId: ds[1].id, result: "FAILED", reason: "INVALID_TOKEN" },
    ]);
    expect((await inbox.findById(n.notificationId))?.state.status).toBe("SENT");
    expect(
      (
        await db.notificationDispatchWork.findUniqueOrThrow({
          where: { notificationId: n.notificationId },
        })
      ).completedAt,
    ).not.toBeNull();
  });
  it("suppresses cancelled deliveries and prevents a leased worker resurrecting them", async () => {
    const n = await create(),
      l = await lease();
    await repo.resolveTargets(l, [randomUUID()]);
    expect(
      await repo.suppress(n.notificationId, foreign, "DISPATCH_CANCELLED"),
    ).toBe(false);
    expect(
      await repo.suppress(n.notificationId, owner, "DISPATCH_CANCELLED"),
    ).toBe(true);
    expect(await repo.settle(l, [])).toBe(false);
    expect(
      (
        await db.notificationDelivery.findFirstOrThrow({
          where: { notificationId: n.notificationId },
        })
      ).status,
    ).toBe("SKIPPED");
    expect(
      (await inbox.findById(n.notificationId))?.state.suppressionReason,
    ).toBe("DISPATCH_CANCELLED");
  });
  it("finishes all-rejected deliveries and keeps repeated suppression idempotent", async () => {
    const n = await create(),
      l = await lease();
    await repo.resolveTargets(l, [randomUUID()]);
    const delivery = await db.notificationDelivery.findFirstOrThrow({
      where: { notificationId: n.notificationId },
    });
    await repo.settle(l, [
      { deliveryId: delivery.id, result: "FAILED", reason: "INVALID_TOKEN" },
    ]);
    expect((await inbox.findById(n.notificationId))?.state).toMatchObject({
      status: "FAILED",
      failureReason: "ALL_DELIVERIES_FAILED",
    });
    await repo.suppress(n.notificationId, owner, "DISPATCH_CANCELLED");
    const first = (await inbox.findById(n.notificationId))!.state;
    await repo.suppress(n.notificationId, owner, "DISPATCH_EXPIRED");
    const replay = (await inbox.findById(n.notificationId))!.state;
    expect(replay.suppressedAt).toEqual(first.suppressedAt);
    expect(replay.failedAt).toEqual(first.failedAt);
    expect(replay.suppressionReason).toBe("DISPATCH_CANCELLED");
  });
  it("handles future eligibility and expired dispatch without sending", async () => {
    const i = input();
    i.eligibleAt = new Date(Date.now() + 60000);
    await intake.execute("reminder-due", i);
    expect(await repo.claim("worker")).toBeNull();
    const expired = input();
    expired.eligibleAt = new Date(0);
    expired.expiresAt = new Date(1);
    const n = await intake.execute("reminder-due", expired);
    expect(await repo.claim("worker")).toBeNull();
    expect(
      (await inbox.findById(n.notificationId))?.state.suppressionReason,
    ).toBe("DISPATCH_EXPIRED");
  });
  it("bounds repeated crashed claims", async () => {
    const n = await create();
    for (let i = 0; i < 3; i++) await expire(await lease());
    expect(await repo.claim("worker")).toBeNull();
    expect((await inbox.findById(n.notificationId))?.state.failureReason).toBe(
      "DISPATCH_ATTEMPTS_EXHAUSTED",
    );
  });
  it("scopes read state to the owner, idempotently, independently of push", async () => {
    const n = await create();
    expect(await inbox.findByIdAndUserId(n.notificationId, foreign)).toBeNull();
    expect(await inbox.markRead(n.notificationId, foreign)).toBe(false);
    expect(await inbox.markRead(n.notificationId, owner)).toBe(true);
    const first = (await inbox.findById(n.notificationId))!.state.readAt;
    await inbox.markRead(n.notificationId, owner);
    const state = (await inbox.findById(n.notificationId))!.state;
    expect(state.readAt).toEqual(first);
    expect(state.status).toBe("PENDING");
    expect(await inbox.findByUserId(foreign)).toEqual([]);
    await expect(
      inbox.save((await inbox.findById(n.notificationId))!),
    ).rejects.toThrow("Managed");
  });
  it("enforces local foreign keys, unique targets and dispatch checks", async () => {
    await expect(
      db.notificationInboxRecord.create({
        data: {
          consumer: "test",
          eventId: randomUUID(),
          notificationId: randomUUID(),
        },
      }),
    ).rejects.toThrow();
    const n = await create(),
      l = await lease();
    const target = randomUUID();
    await repo.resolveTargets(l, [target, target]);
    expect(
      await db.notificationDelivery.count({
        where: { notificationId: n.notificationId },
      }),
    ).toBe(1);
    await expect(
      db.$executeRaw`UPDATE notifications SET dispatch_version=0 WHERE id=${n.notificationId}::uuid`,
    ).rejects.toThrow();
    const fks = await db.$queryRaw<
      { table_name: string }[]
    >`SELECT ccu.table_name FROM information_schema.constraint_column_usage ccu JOIN information_schema.table_constraints tc ON ccu.constraint_name=tc.constraint_name AND ccu.constraint_schema=tc.constraint_schema WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'`;
    expect(fks.every((f) => f.table_name === "notifications")).toBe(true);
  });
});
