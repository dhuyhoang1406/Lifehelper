import { randomUUID } from "node:crypto";
import type { Prisma } from "../../generated/client";
type LifecycleEvent =
  | "document.deleted"
  | "document.cleanup.completed"
  | "document.reprocess.requested"
  | "document.processing.completed"
  | "document.uploaded"
  | "document.processing.started"
  | "document.processing.failed"
  | "document.processing.extracted";
export async function documentEvent(
  tx: Prisma.TransactionClient,
  type: LifecycleEvent,
  documentId: string,
  jobId: string,
  generation: number,
  attempt: number,
  at: Date,
  errorCode?: string,
  metrics: Record<string, string | number> = {},
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
          ...Object.fromEntries(
            Object.entries(metrics).filter(
              ([key, value]) =>
                [
                  "durationMs",
                  "chunkCount",
                  "textChars",
                  "estimatedInputTokens",
                  "embeddingValues",
                  "embeddingModel",
                  "embeddingVersion",
                  "embeddingDimensions",
                ].includes(key) &&
                (typeof value === "string" ||
                  (typeof value === "number" && Number.isFinite(value))),
            ),
          ),
        },
      },
    },
  });
}
