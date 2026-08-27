import type {
  DailyProductivityMetric as MetricRecord,
  EventProcessingLog as LogRecord,
} from "../../generated/client";
import { PrismaService } from "../prisma.service";
import type {
  DailyProductivityMetricRepository,
  EventProcessingLogRepository,
} from "../application/repositories/analytics.repositories";
import { DailyProductivityMetric } from "../modules/analytics/domain/entities/daily-productivity-metric.entity";
import { EventProcessingLog } from "../modules/analytics/domain/entities/event-processing-log.entity";
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const DailyProductivityMetricMapper = {
  toDomain: (r: MetricRecord) =>
    DailyProductivityMetric.restore({
      ...r,
      metricDate: dateOnly(r.metricDate),
    }),
  toPersistence: (e: DailyProductivityMetric) => ({
    ...e.state,
    metricDate: toDate(e.state.metricDate),
  }),
};
export const EventProcessingLogMapper = {
  toDomain: (r: LogRecord) => EventProcessingLog.restore(r),
  toPersistence: (e: EventProcessingLog) => e.state,
};
export class PrismaDailyProductivityMetricRepository implements DailyProductivityMetricRepository {
  constructor(private readonly db: PrismaService) {}
  async findByUserAndDate(userId: string, date: string) {
    const r = await this.db.dailyProductivityMetric.findUnique({
      where: { userId_metricDate: { userId, metricDate: toDate(date) } },
    });
    return r ? DailyProductivityMetricMapper.toDomain(r) : null;
  }
  async save(e: DailyProductivityMetric) {
    const data = DailyProductivityMetricMapper.toPersistence(e);
    await this.db.dailyProductivityMetric.upsert({
      where: { id: e.state.id },
      create: data,
      update: data,
    });
  }
}
export class PrismaEventProcessingLogRepository implements EventProcessingLogRepository {
  constructor(private readonly db: PrismaService) {}
  async exists(eventId: string) {
    return (await this.db.eventProcessingLog.count({ where: { eventId } })) > 0;
  }
  async save(e: EventProcessingLog) {
    const data = EventProcessingLogMapper.toPersistence(e);
    await this.db.eventProcessingLog.upsert({
      where: { eventId: e.state.eventId },
      create: data,
      update: data,
    });
  }
}
