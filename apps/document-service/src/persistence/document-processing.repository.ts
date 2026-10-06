import { randomUUID } from "node:crypto";
import type { Prisma } from "../../generated/client";
import { PrismaService } from "../prisma.service";
import type {
  DocumentProcessingRepository,
  ProcessingLease,
  PreparedGeneration,
} from "../modules/document/application/ports/document-processing.port";
import {
  DocumentApplicationError,
  documentNotFound,
} from "../modules/document/application/errors/document.errors";
import { DocumentChunk } from "../modules/document/domain/entities/document-chunk.entity";
import { DocumentEmbedding } from "../modules/document/domain/entities/document-embedding.entity";
import {
  DocumentProcessingFailure,
  processingFailures,
  retryDelay,
  retryEligible,
  type ProcessingFailureCode,
  type ProcessingRetryPolicy,
} from "../modules/document/domain/processing-policy";
import { documentEvent } from "./document-outbox";
export interface ProcessingPersistenceLimits extends ProcessingRetryPolicy {
  leaseMs: number;
  maxChunks: number;
  maxTextChars: number;
  maxVectorValues: number;
}
class LostProcessingLease extends Error {}
async function dbNow(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<
    Array<{ at: Date }>
  >`SELECT clock_timestamp() AS at`;
  return rows[0].at;
}
async function lockDocument(
  tx: Prisma.TransactionClient,
  id: string,
  userId?: string,
) {
  const rows =
    userId === undefined
      ? await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT id FROM documents WHERE id=${id}::uuid FOR UPDATE`
      : await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT id FROM documents WHERE id=${id}::uuid AND user_id=${userId}::uuid FOR UPDATE`;
  return rows.length ? tx.document.findUniqueOrThrow({ where: { id } }) : null;
}
export class PrismaDocumentProcessingRepository implements DocumentProcessingRepository {
  constructor(
    private readonly db: PrismaService,
    private readonly limits: ProcessingPersistenceLimits,
    private readonly random = Math.random,
  ) {}
  async claim(owner: string): Promise<ProcessingLease | null> {
    if (!owner.trim() || owner.length > 128)
      throw new Error("Invalid worker owner");
    return this.db.$transaction(async (tx) => {
      // Every writer locks Document before Job; SKIP LOCKED lets replicas claim independently.
      const candidates = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT d.id FROM documents d WHERE EXISTS (
          SELECT 1 FROM document_processing_jobs j WHERE j.document_id=d.id AND
            ((j.status='PENDING' AND j.next_attempt_at<=clock_timestamp()) OR
             (j.status='RUNNING' AND j.lease_expires_at<=clock_timestamp())))
        ORDER BY d.updated_at,d.id FOR UPDATE OF d SKIP LOCKED LIMIT 1`;
      if (!candidates.length) return null;
      let d = await tx.document.findUniqueOrThrow({
        where: { id: candidates[0].id },
      });
      const at = await dbNow(tx);
      const j = await tx.documentProcessingJob.findFirst({
        where: {
          documentId: d.id,
          OR: [
            { status: "PENDING", nextAttemptAt: { lte: at } },
            { status: "RUNNING", leaseExpiresAt: { lte: at } },
          ],
        },
        orderBy: { generation: "asc" },
      });
      if (!j) return null;
      const eligible =
        !d.deletedAt &&
        ((d.status === "PROCESSING" &&
          j.generation === d.processingGeneration) ||
          (["UPLOADED", "FAILED"].includes(d.status) &&
            j.generation === d.processingGeneration + 1));
      if (!eligible) {
        await tx.documentProcessingJob.update({
          where: { id: j.id },
          data: {
            status: "CANCELLED",
            leaseOwner: null,
            leaseExpiresAt: null,
            updatedAt: at,
          },
        });
        await tx.documentGeneration.updateMany({
          where: {
            documentId: d.id,
            generation: j.generation,
            status: "PROCESSING",
          },
          data: { status: "FAILED" },
        });
        return null;
      }
      if (d.status !== "PROCESSING") {
        d = await tx.document.update({
          where: { id: d.id },
          data: {
            status: "PROCESSING",
            processingGeneration: j.generation,
            processingError: null,
            revision: { increment: 1 },
            updatedAt: at,
          },
        });
      }
      if (!d.storageVersionId || !d.checksumSha256) {
        await this.terminalFailure(
          tx,
          d.id,
          j.id,
          j.generation,
          j.attemptCount,
          "DOCUMENT_SOURCE_MISMATCH",
          at,
        );
        return null;
      }
      if (j.attemptCount >= this.limits.maxAttempts) {
        await this.terminalFailure(
          tx,
          d.id,
          j.id,
          j.generation,
          j.attemptCount,
          "DOCUMENT_WORKER_LEASE_EXPIRED",
          at,
        );
        return null;
      }
      if (j.status === "RUNNING") {
        await tx.documentProcessingJob.update({
          where: { id: j.id },
          data: {
            status: "PENDING",
            leaseOwner: null,
            leaseExpiresAt: null,
            nextAttemptAt: new Date(
              at.getTime() +
                retryDelay(j.attemptCount, this.limits, this.random),
            ),
            errorCode: "DOCUMENT_WORKER_LEASE_EXPIRED",
            updatedAt: at,
          },
        });
        return null;
      }
      const expiresAt = new Date(at.getTime() + this.limits.leaseMs);
      const job = await tx.documentProcessingJob.update({
        where: { id: j.id },
        data: {
          status: "RUNNING",
          attemptCount: { increment: 1 },
          leaseToken: { increment: 1 },
          leaseOwner: owner,
          leaseExpiresAt: expiresAt,
          errorCode: null,
          updatedAt: at,
        },
      });
      await documentEvent(
        tx,
        "document.processing.started",
        d.id,
        j.id,
        j.generation,
        job.attemptCount,
        at,
      );
      return {
        id: job.id,
        documentId: d.id,
        generation: j.generation,
        owner,
        token: job.leaseToken,
        attemptCount: job.attemptCount,
        expiresAt,
        source: {
          bucket: d.s3Bucket,
          key: d.s3Key,
          versionId: d.storageVersionId!,
          checksumSha256: d.checksumSha256!,
          sizeBytes: d.sizeBytes,
          mimeType: d.mimeType,
          filename: d.storageFilename,
        },
      };
    });
  }
  private async currentLease(
    tx: Prisma.TransactionClient,
    lease: ProcessingLease,
  ) {
    const d = await lockDocument(tx, lease.documentId);
    const at = await dbNow(tx);
    const j = await tx.documentProcessingJob.findUnique({
      where: { id: lease.id },
    });
    if (
      !d ||
      d.deletedAt ||
      d.status !== "PROCESSING" ||
      d.processingGeneration !== lease.generation ||
      !j ||
      j.documentId !== d.id ||
      j.generation !== lease.generation ||
      j.status !== "RUNNING" ||
      j.leaseOwner !== lease.owner ||
      j.leaseToken !== lease.token ||
      !j.leaseExpiresAt ||
      j.leaseExpiresAt <= at
    )
      return null;
    return { d, j, at };
  }
  private prepared(lease: ProcessingLease, result: PreparedGeneration) {
    if (
      !result ||
      !Array.isArray(result.chunks) ||
      !Array.isArray(result.embeddings) ||
      result.chunks.length < 1 ||
      result.chunks.length > this.limits.maxChunks ||
      result.chunks.length !== result.embeddings.length
    )
      throw new DocumentProcessingFailure("DOCUMENT_PROCESSING_RESULT_INVALID");
    try {
      if (
        result.chunks.some((c) => !(c instanceof DocumentChunk)) ||
        result.embeddings.some((e) => !(e instanceof DocumentEmbedding)) ||
        result.chunks.reduce((sum, c) => sum + c.state.content.length, 0) >
          this.limits.maxTextChars ||
        result.embeddings.reduce(
          (sum, e) => sum + e.state.embedding.length,
          0,
        ) > this.limits.maxVectorValues
      )
        throw new Error();
      const chunks = result.chunks.map((c, i) => {
        if (
          !(c instanceof DocumentChunk) ||
          c.state.documentId !== lease.documentId ||
          c.state.generation !== lease.generation ||
          c.state.chunkIndex !== i ||
          c.state.tokenCount === null ||
          c.state.locator === null
        )
          throw new Error();
        return DocumentChunk.create({
          ...c.state,
          locator: { ...c.state.locator },
        }).state;
      });
      const embeddings = result.embeddings.map((e) => {
        if (!(e instanceof DocumentEmbedding)) throw new Error();
        return DocumentEmbedding.create(e.state).state;
      });
      if (
        new Set(chunks.map((c) => c.id)).size !== chunks.length ||
        new Set(embeddings.map((e) => e.chunkId)).size !== chunks.length ||
        embeddings.some(
          (e) =>
            !chunks.some((c) => c.id === e.chunkId) ||
            e.dimensions !== embeddings[0].dimensions ||
            e.embeddingModel !== embeddings[0].embeddingModel ||
            e.modelVersion !== embeddings[0].modelVersion,
        )
      )
        throw new Error();
      return { chunks, embeddings };
    } catch {
      throw new DocumentProcessingFailure("DOCUMENT_PROCESSING_RESULT_INVALID");
    }
  }
  async publish(lease: ProcessingLease, result: PreparedGeneration) {
    const prepared = this.prepared(lease, result);
    try {
      return await this.db.$transaction(async (tx) => {
        const current = await this.currentLease(tx, lease);
        if (!current) return false;
        const { at } = current;
        // Only the current fenced worker can publish prepared results, in this same transaction.
        for (const c of prepared.chunks) {
          await tx.documentChunk.create({
            data: {
              id: c.id,
              documentId: c.documentId,
              generation: c.generation,
              chunkIndex: c.chunkIndex,
              content: c.content,
              tokenCount: c.tokenCount,
              locatorKind: c.locator!.kind,
              locatorStart: c.locator!.start,
              locatorEnd: c.locator!.end,
              createdAt: at,
            },
          });
        }
        for (const e of prepared.embeddings) {
          const vector = `[${e.embedding.join(",")}]`;
          await tx.$executeRaw`INSERT INTO document_embeddings(id,chunk_id,embedding_model,model_version,dimensions,embedding,created_at)
          VALUES(${e.id}::uuid,${e.chunkId}::uuid,${e.embeddingModel},${e.modelVersion},${e.dimensions},${vector}::vector,${at})`;
        }
        const committedAt = await dbNow(tx);
        if (current.j.leaseExpiresAt! <= committedAt)
          throw new LostProcessingLease();
        await tx.documentGeneration.update({
          where: {
            documentId_generation: {
              documentId: lease.documentId,
              generation: lease.generation,
            },
          },
          data: {
            status: "COMPLETE",
            chunkCount: prepared.chunks.length,
            completedAt: at,
          },
        });
        await tx.document.update({
          where: { id: lease.documentId },
          data: {
            status: "READY",
            activeGeneration: lease.generation,
            processingError: null,
            revision: { increment: 1 },
            updatedAt: at,
          },
        });
        await tx.documentProcessingJob.update({
          where: { id: lease.id },
          data: {
            status: "SUCCEEDED",
            leaseOwner: null,
            leaseExpiresAt: null,
            errorCode: null,
            updatedAt: at,
          },
        });
        await documentEvent(
          tx,
          "document.processing.ready",
          lease.documentId,
          lease.id,
          lease.generation,
          lease.attemptCount,
          at,
        );
        if (current.j.leaseExpiresAt! <= (await dbNow(tx)))
          throw new LostProcessingLease();
        return true;
      });
    } catch (error) {
      if (error instanceof LostProcessingLease) return false;
      throw error;
    }
  }
  private async terminalFailure(
    tx: Prisma.TransactionClient,
    documentId: string,
    jobId: string,
    generation: number,
    attempt: number,
    code: ProcessingFailureCode,
    at: Date,
  ) {
    await tx.documentProcessingJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorCode: code,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: at,
      },
    });
    await tx.documentGeneration.update({
      where: { documentId_generation: { documentId, generation } },
      data: { status: "FAILED" },
    });
    await tx.document.update({
      where: { id: documentId },
      data: {
        status: "FAILED",
        processingError: code,
        revision: { increment: 1 },
        updatedAt: at,
      },
    });
    await documentEvent(
      tx,
      "document.processing.failed",
      documentId,
      jobId,
      generation,
      attempt,
      at,
      code,
    );
  }
  async fail(lease: ProcessingLease, code: ProcessingFailureCode) {
    if (!Object.hasOwn(processingFailures, code))
      code = "DOCUMENT_PROCESSING_UNEXPECTED";
    return this.db.$transaction(async (tx) => {
      const current = await this.currentLease(tx, lease);
      if (!current) return false;
      const { at, j } = current;
      if (
        processingFailures[code] &&
        j.attemptCount < this.limits.maxAttempts
      ) {
        await tx.documentProcessingJob.update({
          where: { id: j.id },
          data: {
            status: "PENDING",
            errorCode: code,
            leaseOwner: null,
            leaseExpiresAt: null,
            nextAttemptAt: new Date(
              at.getTime() +
                retryDelay(j.attemptCount, this.limits, this.random),
            ),
            updatedAt: at,
          },
        });
      } else
        await this.terminalFailure(
          tx,
          lease.documentId,
          j.id,
          j.generation,
          j.attemptCount,
          code,
          at,
        );
      return true;
    });
  }
  async retry(documentId: string, userId: string) {
    return this.db.$transaction(async (tx) => {
      const d = await lockDocument(tx, documentId, userId);
      if (!d || d.deletedAt) throw documentNotFound();
      if (
        d.status !== "FAILED" ||
        !d.storageVersionId ||
        !d.checksumSha256 ||
        !retryEligible(d.processingError)
      )
        throw new DocumentApplicationError(
          "DOCUMENT_RETRY_NOT_ELIGIBLE",
          "Document is not eligible for processing retry",
          409,
        );
      const generation = d.processingGeneration + 1;
      const existing = await tx.documentProcessingJob.findUnique({
        where: { documentId_generation: { documentId, generation } },
      });
      if (existing?.status === "PENDING")
        return {
          documentId,
          jobId: existing.id,
          generation,
          status: "PENDING" as const,
        };
      const at = await dbNow(tx);
      const jobId = randomUUID();
      await tx.documentGeneration.create({
        data: { documentId, generation, createdAt: at },
      });
      await tx.documentProcessingJob.create({
        data: {
          id: jobId,
          documentId,
          generation,
          nextAttemptAt: at,
          createdAt: at,
          updatedAt: at,
        },
      });
      return { documentId, jobId, generation, status: "PENDING" as const };
    });
  }
}
