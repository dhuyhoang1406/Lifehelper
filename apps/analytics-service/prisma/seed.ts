import { DEMO_IDS } from "@lifehelper/shared-types";
import { PrismaClient } from "../generated/client";
const db = new PrismaClient();
async function main() {
  await db.dailyProductivityMetric.upsert({
    where: { id: DEMO_IDS.metric },
    update: {},
    create: {
      id: DEMO_IDS.metric,
      userId: DEMO_IDS.user,
      metricDate: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
  });
}
main().finally(() => db.$disconnect());
