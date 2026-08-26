export const EVENT_VERSION = 1 as const;

export interface EventEnvelope<TPayload = unknown> {
  id: string;
  type: string;
  version: typeof EVENT_VERSION;
  occurredAt: string;
  correlationId: string;
  producer: string;
  payload: TPayload;
}
