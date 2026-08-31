import { DEMO_IDS } from "@lifehelper/shared-types";
import { PrismaClient } from "../generated/client";
const db = new PrismaClient();
async function main() {
  const now = new Date("2026-01-01T00:00:00Z");
  await db.conversation.upsert({
    where: { id: DEMO_IDS.conversation },
    update: {},
    create: {
      id: DEMO_IDS.conversation,
      userId: DEMO_IDS.user,
      title: "Demo conversation",
      createdAt: now,
      updatedAt: now,
    },
  });
}
main().finally(() => db.$disconnect());
