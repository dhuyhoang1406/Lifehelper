import type { UUID } from "@lifehelper/shared-types";
import { AnalyticsDomainError } from "../errors/analytics-domain.error";
export interface DailyProductivityMetricProps {
  id: UUID;
  userId: UUID;
  metricDate: string;
  tasksCreated: number;
  tasksCompleted: number;
  habitCheckins: number;
  calendarEvents: number;
  aiRequests: number;
  aiToolActions: number;
  updatedAt: Date;
}
type MetricCounter = Exclude<
  keyof DailyProductivityMetricProps,
  "id" | "userId" | "metricDate" | "updatedAt"
>;
export class DailyProductivityMetric {
  private constructor(private props: DailyProductivityMetricProps) {}
  static create(
    input: Pick<DailyProductivityMetricProps, "id" | "userId" | "metricDate"> &
      Partial<Pick<DailyProductivityMetricProps, "updatedAt">>,
  ): DailyProductivityMetric {
    return new DailyProductivityMetric({
      ...input,
      tasksCreated: 0,
      tasksCompleted: 0,
      habitCheckins: 0,
      calendarEvents: 0,
      aiRequests: 0,
      aiToolActions: 0,
      updatedAt: input.updatedAt ?? new Date(),
    });
  }
  static restore(p: DailyProductivityMetricProps): DailyProductivityMetric {
    for (const value of [
      p.tasksCreated,
      p.tasksCompleted,
      p.habitCheckins,
      p.calendarEvents,
      p.aiRequests,
      p.aiToolActions,
    ])
      if (value < 0)
        throw new AnalyticsDomainError("Metric counters cannot be negative");
    return new DailyProductivityMetric(p);
  }
  get state(): Readonly<DailyProductivityMetricProps> {
    return this.props;
  }
  increment(counter: MetricCounter, amount = 1, at = new Date()): void {
    if (!Number.isInteger(amount) || amount < 1)
      throw new AnalyticsDomainError(
        "Metric increment must be a positive integer",
      );
    this.props[counter] += amount;
    this.props.updatedAt = at;
  }
}
