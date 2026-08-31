import type { UUID } from "@lifehelper/shared-types";
import type { DailyProductivityMetric } from "../../modules/analytics/domain/entities/daily-productivity-metric.entity";
import type { EventProcessingLog } from "../../modules/analytics/domain/entities/event-processing-log.entity";
export interface DailyProductivityMetricRepository {
  findByUserAndDate(
    userId: UUID,
    date: string,
  ): Promise<DailyProductivityMetric | null>;
  save(entity: DailyProductivityMetric): Promise<void>;
}
export interface EventProcessingLogRepository {
  exists(eventId: UUID): Promise<boolean>;
  save(entity: EventProcessingLog): Promise<void>;
}
