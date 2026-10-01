import type {
  Document as DocumentRecord,
  DocumentChunk as ChunkRecord,
} from "../../generated/client";
import { Prisma } from "../../generated/client";
import { PrismaService } from "../prisma.service";
import type {
  DocumentRepository,
  DocumentChunkRepository,
  DocumentGenerationRepository,
  DocumentProcessingJobRepository,
  DocumentEmbeddingRepository,
  DocumentEmbeddingMetadata,
} from "../application/repositories/document.repositories";
import { Document } from "../modules/document/domain/entities/document.entity";
import { DocumentChunk } from "../modules/document/domain/entities/document-chunk.entity";
import { DocumentGeneration } from "../modules/document/domain/entities/document-generation.entity";
import { DocumentProcessingJob } from "../modules/document/domain/entities/document-processing-job.entity";
import { DocumentStatus } from "../modules/document/domain/enums/document-status.enum";
import { DocumentDomainError } from "../modules/document/domain/errors/document-domain.error";
import type { JsonValue } from "@lifehelper/shared-types";

function boundedLimit(limit = 100) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid repository limit");
  return limit;
}
export const DocumentMapper = {
  toDomain: (r: DocumentRecord) =>
    Document.restore({ ...r, status: r.status as DocumentStatus }),
  toPersistence: (e: Document) => e.state,
};
export const DocumentChunkMapper = {
  toDomain: (r: ChunkRecord) => {
    const { locatorKind, locatorStart, locatorEnd, ...rest } = r;
    return DocumentChunk.restore({
      ...rest,
      metadata: r.metadata as JsonValue | null,
      locator:
        locatorKind === null
          ? null
          : {
              kind: locatorKind as "PAGE" | "LINE",
              start: locatorStart!,
              end: locatorEnd!,
            },
    });
  },
  toPersistence: (e: DocumentChunk) => {
    const { locator, ...rest } = e.state;
    return {
      ...rest,
      locatorKind: locator?.kind ?? null,
      locatorStart: locator?.start ?? null,
      locatorEnd: locator?.end ?? null,
      metadata:
        e.state.metadata === null
          ? Prisma.DbNull
          : (e.state.metadata as Prisma.InputJsonValue),
    };
  },
};
export class PrismaDocumentRepository implements DocumentRepository {
  constructor(private readonly db: PrismaService) {}
  async findByIdAndUserId(id: string, userId: string) {
    const r = await this.db.document.findFirst({
      where: { id, userId, deletedAt: null },
    });
    return r ? DocumentMapper.toDomain(r) : null;
  }
  async findByUserId(userId: string, limit = 100) {
    return (
      await this.db.document.findMany({
        where: { userId, deletedAt: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: boundedLimit(limit),
      })
    ).map(DocumentMapper.toDomain);
  }
  async insert(e: Document) {
    if (
      e.state.status !== DocumentStatus.PENDING_UPLOAD ||
      e.state.processingGeneration !== 0 ||
      e.state.activeGeneration !== null
    )
      throw new DocumentDomainError("New documents must be pending upload");
    await this.db.document.create({ data: DocumentMapper.toPersistence(e) });
  }
  async save(e: Document, expectedRevision: number) {
    // READY and generation changes are only persisted by the atomic lifecycle operations below.
    if (
      ![
        DocumentStatus.UPLOADED,
        DocumentStatus.FAILED,
        DocumentStatus.DELETED,
      ].includes(e.state.status)
    )
      throw new DocumentDomainError(
        "Use atomic generation operations for processing and ready states",
      );
    const result = await this.db.document.updateMany({
      where: {
        id: e.state.id,
        userId: e.state.userId,
        revision: expectedRevision,
        deletedAt: null,
        processingGeneration: e.state.processingGeneration,
      },
      data: {
        status: e.state.status,
        processingError: e.state.processingError,
        checksumSha256: e.state.checksumSha256,
        updatedAt: e.state.updatedAt,
        deletedAt: e.state.deletedAt,
        activeGeneration: e.state.activeGeneration,
        revision: { increment: 1 },
      },
    });
    return result.count === 1;
  }
  async startGeneration(
    id: string,
    userId: string,
    expectedRevision: number,
    jobId: string,
    at: Date,
  ) {
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ generation: number }>>`
        UPDATE documents SET status = 'PROCESSING', processing_generation = processing_generation + 1,
          processing_error = NULL, updated_at = ${at}, revision = revision + 1
        WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND revision = ${expectedRevision}
          AND deleted_at IS NULL AND storage_version_id IS NULL AND status IN ('UPLOADED', 'FAILED', 'READY')
        RETURNING processing_generation AS generation`;
      const generation = rows[0]?.generation;
      if (!generation) return null;
      await tx.documentGeneration.create({
        data: DocumentGeneration.create(id, generation, at).state,
      });
      await tx.documentProcessingJob.create({
        data: DocumentProcessingJob.create(jobId, id, generation, at).state,
      });
      return generation;
    });
  }
  async activateGeneration(
    id: string,
    userId: string,
    generation: number,
    expectedRevision: number,
    at: Date,
  ) {
    return this.db.$transaction(async (tx) => {
      // Lock the owner-scoped document to serialize activation, retries and deletion.
      const docs = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM documents WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
          AND deleted_at IS NULL AND status = 'PROCESSING' AND processing_generation = ${generation}
          AND revision = ${expectedRevision} FOR UPDATE`;
      // Verified sources must use the fenced processing publisher, never this legacy adapter.
      if (docs.length) {
        const document = await tx.document.findUniqueOrThrow({ where: { id } });
        if (document.storageVersionId !== null) return false;
      }
      if (!docs.length) return false;
      const counts = await tx.$queryRaw<
        Array<{ count: number; valid: number; maximum: number }>
      >`
        SELECT count(*)::int AS count, count(*) FILTER (WHERE c.token_count IS NOT NULL
          AND c.locator_kind IS NOT NULL AND e.embedding IS NOT NULL)::int AS valid,
          max(c.chunk_index)::int AS maximum
        FROM document_chunks c LEFT JOIN document_embeddings e ON e.chunk_id = c.id
        WHERE c.document_id = ${id}::uuid AND c.generation = ${generation}`;
      const count = counts[0];
      if (
        !count ||
        count.count < 1 ||
        count.valid !== count.count ||
        count.maximum !== count.count - 1
      )
        return false;
      const changed = await tx.documentGeneration.updateMany({
        where: { documentId: id, generation, status: "PROCESSING" },
        data: { status: "COMPLETE", chunkCount: count.count, completedAt: at },
      });
      if (!changed.count) return false;
      await tx.document.update({
        where: { id },
        data: {
          status: "READY",
          activeGeneration: generation,
          processingError: null,
          updatedAt: at,
          revision: { increment: 1 },
        },
      });
      return true;
    });
  }
}
export class PrismaDocumentChunkRepository implements DocumentChunkRepository {
  constructor(private readonly db: PrismaService) {}
  async findByDocumentAndUserId(
    documentId: string,
    userId: string,
    generation: number,
    limit = 100,
  ) {
    return (
      await this.db.documentChunk.findMany({
        where: {
          documentId,
          generation,
          document: { userId, deletedAt: null },
        },
        orderBy: { chunkIndex: "asc" },
        take: boundedLimit(limit),
      })
    ).map(DocumentChunkMapper.toDomain);
  }
  async insert(e: DocumentChunk, userId: string) {
    if (e.state.locator === null || e.state.tokenCount === null)
      throw new DocumentDomainError(
        "New chunks require token counts and source locators",
      );
    await this.db.$transaction(async (tx) => {
      const owner = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM documents
        WHERE id = ${e.state.documentId}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL
          AND storage_version_id IS NULL AND status = 'PROCESSING' AND processing_generation = ${e.state.generation} FOR UPDATE`;
      if (!owner.length)
        throw new DocumentDomainError("Processing document not found");
      await tx.documentChunk.create({
        data: DocumentChunkMapper.toPersistence(e),
      });
    });
  }
}
export class PrismaDocumentGenerationRepository implements DocumentGenerationRepository {
  constructor(private readonly db: PrismaService) {}
  async findByDocumentAndUserId(
    documentId: string,
    userId: string,
    generation: number,
  ) {
    const r = await this.db.documentGeneration.findFirst({
      where: { documentId, generation, document: { userId, deletedAt: null } },
    });
    return r ? DocumentGeneration.restore(r) : null;
  }
}
export class PrismaDocumentProcessingJobRepository implements DocumentProcessingJobRepository {
  constructor(private readonly db: PrismaService) {}
  async findByDocumentAndUserId(
    documentId: string,
    userId: string,
    generation: number,
  ) {
    const r = await this.db.documentProcessingJob.findFirst({
      where: { documentId, generation, document: { userId, deletedAt: null } },
    });
    return r ? DocumentProcessingJob.restore(r) : null;
  }
}
export class PrismaDocumentEmbeddingRepository implements DocumentEmbeddingRepository {
  constructor(private readonly db: PrismaService) {}
  async insertMetadata(e: DocumentEmbeddingMetadata, userId: string) {
    if (
      !Number.isSafeInteger(e.dimensions) ||
      e.dimensions < 1 ||
      !e.embeddingModel.trim() ||
      !e.modelVersion.trim()
    )
      throw new DocumentDomainError("Invalid embedding metadata");
    await this.db.$transaction(async (tx) => {
      const owner = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT d.id FROM documents d
        JOIN document_chunks c ON c.document_id = d.id AND c.generation = d.processing_generation
        WHERE c.id = ${e.chunkId}::uuid AND d.user_id = ${userId}::uuid
          AND d.deleted_at IS NULL AND d.storage_version_id IS NULL AND d.status = 'PROCESSING' FOR UPDATE OF d`;
      if (!owner.length)
        throw new DocumentDomainError("Processing chunk not found");
      await tx.documentEmbedding.create({ data: e });
    });
  }
  async findByChunkAndUserId(chunkId: string, userId: string) {
    return this.db.documentEmbedding.findFirst({
      where: { chunkId, chunk: { document: { userId, deletedAt: null } } },
    });
  }
}
