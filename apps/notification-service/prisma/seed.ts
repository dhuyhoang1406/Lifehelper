import { DEMO_IDS } from "@lifehelper/shared-types";
import {
  NotificationStatus,
  NotificationType,
  PrismaClient,
} from "../generated/client";
const db = new PrismaClient();
async function main() {
  const now = new Date("2026-01-01T00:00:00Z");
  await db.notification.upsert({
    where: { id: DEMO_IDS.notification },
    update: {},
    create: {
      id: DEMO_IDS.notification,
      userId: DEMO_IDS.user,
      type: NotificationType.SYSTEM,
      title: "Welcome",
      body: "Welcome to Lifehelper",
      status: NotificationStatus.PENDING,
      createdAt: now,
    },
  });
}
main().finally(() => db.$disconnect());
