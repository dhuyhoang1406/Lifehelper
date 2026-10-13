import type { Prisma } from "../../generated/client";
import type { ProcessingLease } from "../modules/document/application/ports/document-processing.port";
export async function processingAudit(
  tx: Prisma.TransactionClient,
  lease: ProcessingLease,
  status: string,
  at: Date,
  durationMs?: number,
  metrics?: {
    chunkCount: number;
    textChars: number;
    estimatedInputTokens: number;
    embeddingValues?: number;
    embeddingModel?: string;
    embeddingVersion?: string;
    embeddingDimensions?: number;
  },
  errorCode?: string,
) {
  const duration =
    durationMs === undefined
      ? null
      : Math.min(2147483647, Math.max(0, Math.floor(durationMs)));
  await tx.documentProcessingAudit.updateMany({
    where: { jobId: lease.id, leaseToken: lease.token, status: "RUNNING" },
    data: {
      status,
      finishedAt: at,
      durationMs: duration,
      metrics: metrics as Prisma.InputJsonValue | undefined,
      errorCode: errorCode ?? null,
    },
  });
  return { ...(duration === null ? {} : { durationMs: duration }), ...metrics };
}
