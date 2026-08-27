import type { JsonValue } from "./index";
export interface PersistenceMapper<TDomain, TPersistence> {
  toDomain(record: TPersistence): TDomain;
  toPersistence(entity: TDomain): object;
}
export interface OutboxEventInput {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: JsonValue;
  occurredAt: Date;
}
