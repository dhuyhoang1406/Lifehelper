import type { UUID } from "@lifehelper/shared-types";
import { AnalyticsDomainError } from "../errors/analytics-domain.error";
export interface EventProcessingLogProps {
  eventId: UUID;
  eventType: string;
  consumer: string;
  processedAt: Date;
}
export class EventProcessingLog {
  private constructor(private readonly props: EventProcessingLogProps) {}
  static create(
    input: Omit<EventProcessingLogProps, "processedAt"> &
      Partial<Pick<EventProcessingLogProps, "processedAt">>,
  ): EventProcessingLog {
    if (!input.eventType.trim() || !input.consumer.trim())
      throw new AnalyticsDomainError("Event type and consumer are required");
    return new EventProcessingLog({
      ...input,
      eventType: input.eventType.trim(),
      consumer: input.consumer.trim(),
      processedAt: input.processedAt ?? new Date(),
    });
  }
  static restore(p: EventProcessingLogProps): EventProcessingLog {
    return new EventProcessingLog(p);
  }
  get state(): Readonly<EventProcessingLogProps> {
    return this.props;
  }
}
