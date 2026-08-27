import { DEMO_IDS } from "@lifehelper/shared-types";
import { PrismaClient, UserStatus, DevicePlatform } from "../generated/client";
const db = new PrismaClient();
async function main() {
  const now = new Date("2026-01-01T00:00:00Z");
  await db.user.upsert({
    where: { id: DEMO_IDS.user },
    update: {},
    create: {
      id: DEMO_IDS.user,
      email: "demo@lifehelper.local",
      displayName: "Demo User",
      status: UserStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.deviceSession.upsert({
    where: { id: DEMO_IDS.deviceSession },
    update: {},
    create: {
      id: DEMO_IDS.deviceSession,
      userId: DEMO_IDS.user,
      deviceId: "demo-device",
      platform: DevicePlatform.WEB,
      lastActiveAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
}
main().finally(() => db.$disconnect());
