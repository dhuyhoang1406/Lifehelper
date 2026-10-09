import { randomUUID } from "node:crypto";
import type { Prisma } from "../../generated/client";
import { PrismaService } from "../prisma.service";
import type {
  DocumentProcessingRepository,
  ProcessingLease,
  PreparedGeneration,
  PreparedExtraction,
} from "../modules/document/application/ports/document-processing.port";
import {
  DocumentApplicationError,
  documentNotFound,
} from "../modules/document/application/errors/document.errors";
import { DocumentGeneration } from "../modules/document/domain/entities/document-generation.entity";
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
import { DocumentChunkMapper } from "./document.persistence";
import { documentEvent } from "./document-outbox";
export interface ProcessingPersistenceLimits extends ProcessingRetryPolicy {
  leaseMs: number;
  maxChunks: number;
  maxTextChars: number;
  maxVectorValues: number;
  embeddingSpace?: { model: string; version: string; dimensions: number };
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
            status: { in: ["PROCESSING", "EXTRACTED"] },
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
  private preparedChunks(
    lease: ProcessingLease,
    chunks: readonly DocumentChunk[],
  ) {
    try {
      if (
        !Array.isArray(chunks) ||
        chunks.length < 1 ||
        chunks.length > this.limits.maxChunks ||
        chunks.some((c) => !(c instanceof DocumentChunk)) ||
        chunks.reduce((sum, c) => sum + c.state.content.length, 0) >
          this.limits.maxTextChars
      )
        throw new Error();
      const prepared = chunks.map((c, i) => {
        if (
          c.state.documentId !== lease.documentId ||
          c.state.generation !== lease.generation ||
          c.state.chunkIndex !== i ||
          c.state.tokenCount === null ||
          c.state.tokenCount < 1 ||
          c.state.locator === null
        )
          throw new Error();
        return DocumentChunk.create({
          ...c.state,
          locator: { ...c.state.locator },
        }).state;
      });
      if (new Set(prepared.map((c) => c.id)).size !== prepared.length)
        throw new Error();
      return prepared;
    } catch {
      throw new DocumentProcessingFailure("DOCUMENT_PROCESSING_RESULT_INVALID");
    }
  }
  private prepared(lease: ProcessingLease, result: PreparedGeneration) {
    const chunks = this.preparedChunks(lease, result?.chunks);
    try {
      if (
        !Array.isArray(result.embeddings) ||
        result.embeddings.length !== chunks.length ||
        result.embeddings.some((e) => !(e instanceof DocumentEmbedding)) ||
        result.embeddings.reduce(
          (sum, e) => sum + e.state.embedding.length,
          0,
        ) > this.limits.maxVectorValues
      )
        throw new Error();
      const embeddings = result.embeddings.map(
        (e) => DocumentEmbedding.create(e.state).state,
      );
      if (
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
      const expected = this.limits.embeddingSpace;
      if (
        expected &&
        embeddings.some(
          (e) =>
            e.embeddingModel !== expected.model ||
            e.modelVersion !== expected.version ||
            e.dimensions !== expected.dimensions,
        )
      )
        throw new DocumentProcessingFailure(
          "DOCUMENT_EMBEDDING_MODEL_MISMATCH",
        );
      const supplied = result.embeddingSettings;
      if (
        supplied &&
        (!Number.isSafeInteger(supplied.batchSize) ||
          supplied.batchSize < 1 ||
          supplied.batchSize > 32 ||
          !Number.isSafeInteger(supplied.maxInputTokens) ||
          supplied.maxInputTokens < 4 ||
          supplied.maxInputTokens > 8192 ||
          supplied.inputPolicy !== "plain-text-v1" ||
          supplied.tokenEstimator !== "utf8-byte-upper-bound-v1")
      )
        throw new Error();
      const embeddingSettings = supplied
        ? {
            batchSize: supplied.batchSize,
            maxInputTokens: supplied.maxInputTokens,
            inputPolicy: supplied.inputPolicy,
            tokenEstimator: supplied.tokenEstimator,
          }
        : {
            inputPolicy: "legacy",
            batchSize: 1,
            maxInputTokens: 0,
            tokenEstimator: "legacy",
          };
      return { chunks, embeddings, embeddingSettings };
    } catch (error) {
      if (error instanceof DocumentProcessingFailure) throw error;
      throw new DocumentProcessingFailure("DOCUMENT_PROCESSING_RESULT_INVALID");
    }
  }
  async loadExtraction(
    lease: ProcessingLease,
  ): Promise<PreparedExtraction | null> {
    return this.db.$transaction(async (tx) => {
      const current = await this.currentLease(tx, lease);
      if (!current)
        throw new DocumentProcessingFailure("DOCUMENT_WORKER_LEASE_EXPIRED");
      const generation = await tx.documentGeneration.findUniqueOrThrow({
        where: {
          documentId_generation: {
            documentId: lease.documentId,
            generation: lease.generation,
          },
        },
      });
      if (generation.status !== "EXTRACTED") return null;
      if (
        generation.sourceChecksumSha256 !== current.d.checksumSha256 ||
        generation.sourceVersionId !== current.d.storageVersionId
      )
        throw new DocumentProcessingFailure("DOCUMENT_SOURCE_MISMATCH");
      const records = await tx.documentChunk.findMany({
        where: { documentId: lease.documentId, generation: lease.generation },
        orderBy: { chunkIndex: "asc" },
      });
      const chunks = records.map(DocumentChunkMapper.toDomain);
      this.preparedChunks(lease, chunks);
      if (chunks.length !== generation.chunkCount)
        throw new DocumentProcessingFailure(
          "DOCUMENT_PROCESSING_RESULT_INVALID",
        );
      return {
        kind: "extracted",
        chunks,
        processingVersion: generation.processingVersion!,
        sourceChecksumSha256: generation.sourceChecksumSha256!,
        sourceVersionId: generation.sourceVersionId!,
      };
    });
  }
  async stageExtraction(
    lease: ProcessingLease,
    result: PreparedExtraction,
    continueIndexing = false,
  ) {
    const chunks = this.preparedChunks(lease, result.chunks);
    if (
      result.kind !== "extracted" ||
      typeof result.processingVersion !== "string" ||
      !result.processingVersion.trim() ||
      result.processingVersion.length > 100 ||
      result.sourceChecksumSha256 !== lease.source.checksumSha256 ||
      result.sourceVersionId !== lease.source.versionId
    )
      throw new DocumentProcessingFailure("DOCUMENT_PROCESSING_RESULT_INVALID");
    try {
      return await this.db.$transaction(async (tx) => {
        const current = await this.currentLease(tx, lease);
        if (!current) return false;
        if (
          current.d.checksumSha256 !== result.sourceChecksumSha256 ||
          current.d.storageVersionId !== result.sourceVersionId
        )
          throw new DocumentProcessingFailure("DOCUMENT_SOURCE_MISMATCH");
        const { at } = current;
        const generation = DocumentGeneration.restore(
          await tx.documentGeneration.findUniqueOrThrow({
            where: {
              documentId_generation: {
                documentId: lease.documentId,
                generation: lease.generation,
              },
            },
          }),
        );
        generation.extract(chunks.length, result, at);
        for (const c of chunks)
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
        await tx.documentGeneration.update({
          where: {
            documentId_generation: {
              documentId: lease.documentId,
              generation: lease.generation,
            },
          },
          data: {
            status: generation.state.status,
            chunkCount: generation.state.chunkCount,
            processingVersion: generation.state.processingVersion,
            sourceChecksumSha256: generation.state.sourceChecksumSha256,
            sourceVersionId: generation.state.sourceVersionId,
            extractedAt: generation.state.extractedAt,
          },
        });
        await tx.documentProcessingJob.update({
          where: { id: lease.id },
          data: {
            status: continueIndexing ? "PENDING" : "SUCCEEDED",
            ...(continueIndexing ? { attemptCount: 0, nextAttemptAt: at } : {}),
            leaseOwner: null,
            leaseExpiresAt: null,
            errorCode: null,
            updatedAt: at,
          },
        });
        await tx.document.update({
          where: { id: lease.documentId },
          data: { updatedAt: at, revision: { increment: 1 } },
        });
        await documentEvent(
          tx,
          "document.processing.extracted",
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
  async publish(lease: ProcessingLease, result: PreparedGeneration) {
    const prepared = this.prepared(lease, result);
    try {
      return await this.db.$transaction(async (tx) => {
        const current = await this.currentLease(tx, lease);
        if (!current) return false;
        const { at } = current;
        const generation = await tx.documentGeneration.findUniqueOrThrow({
          where: {
            documentId_generation: {
              documentId: lease.documentId,
              generation: lease.generation,
            },
          },
        });
        if (this.limits.embeddingSpace && generation.status !== "EXTRACTED")
          throw new DocumentProcessingFailure(
            "DOCUMENT_PROCESSING_RESULT_INVALID",
          );
        if (generation.status === "EXTRACTED") {
          const stored = await tx.documentChunk.findMany({
            where: {
              documentId: lease.documentId,
              generation: lease.generation,
            },
            orderBy: { chunkIndex: "asc" },
          });
          if (
            stored.length !== prepared.chunks.length ||
            generation.chunkCount !== stored.length ||
            generation.sourceChecksumSha256 !== current.d.checksumSha256 ||
            generation.sourceVersionId !== current.d.storageVersionId ||
            stored.some(
              (c, i) =>
                c.id !== prepared.chunks[i].id ||
                c.content !== prepared.chunks[i].content ||
                c.chunkIndex !== prepared.chunks[i].chunkIndex ||
                c.tokenCount !== prepared.chunks[i].tokenCount ||
                c.locatorKind !== prepared.chunks[i].locator!.kind ||
                c.locatorStart !== prepared.chunks[i].locator!.start ||
                c.locatorEnd !== prepared.chunks[i].locator!.end,
            )
          )
            throw new DocumentProcessingFailure(
              "DOCUMENT_PROCESSING_RESULT_INVALID",
            );
        } else {
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
            embeddingModel: prepared.embeddings[0].embeddingModel,
            embeddingVersion: prepared.embeddings[0].modelVersion,
            embeddingDimensions: prepared.embeddings[0].dimensions,
            embeddingSettings: prepared.embeddingSettings,
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
