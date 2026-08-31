import { PrismaService } from "../src/prisma.service";
import { PrismaDailyProductivityMetricRepository } from "../src/persistence/analytics.persistence";
import { DailyProductivityMetric } from "../src/modules/analytics/domain/entities/daily-productivity-metric.entity";
const db = new PrismaService();
const id = "10000000-0000-4000-8000-000000000006";
describe("Analytics persistence", () => {
  const repo = new PrismaDailyProductivityMetricRepository(db);
  beforeAll(() => db.$connect());
  afterAll(async () => {
    await db.dailyProductivityMetric.deleteMany({ where: { id } });
    await db.$disconnect();
  });
  it("round-trips date-only metrics", async () => {
    const entity = DailyProductivityMetric.create({
      id,
      userId: "00000000-0000-4000-8000-000000000001",
      metricDate: "2026-02-01",
    });
    entity.increment("tasksCompleted");
    await repo.save(entity);
    expect(
      (
        await repo.findByUserAndDate(
          entity.state.userId,
          entity.state.metricDate,
        )
      )?.state.tasksCompleted,
    ).toBe(1);
  });
});
