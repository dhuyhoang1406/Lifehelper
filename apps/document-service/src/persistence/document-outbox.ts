import { randomUUID } from "node:crypto";
import type { Prisma } from "../../generated/client";
type LifecycleEvent =
  | "document.uploaded"
  | "document.processing.started"
  | "document.processing.failed"
  | "document.processing.extracted"
  | "document.processing.ready";
export async function documentEvent(
  tx: Prisma.TransactionClient,
  type: LifecycleEvent,
  documentId: string,
  jobId: string,
  generation: number,
  attempt: number,
  at: Date,
  errorCode?: string,
) {
  const id = randomUUID();
  await tx.outboxEvent.create({
    data: {
      id,
      eventType: type,
      aggregateType: "document",
      aggregateId: documentId,
      occurredAt: at,
      payload: {
        id,
        type,
        version: 1,
        producer: "document-service",
        correlationId: jobId,
        occurredAt: at.toISOString(),
        payload: {
          documentId,
          jobId,
          generation,
          attempt,
          ...(errorCode ? { errorCode } : {}),
        },
      },
    },
  });
}
