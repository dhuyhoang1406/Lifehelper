import type { UUID } from "@lifehelper/shared-types";
import type { Document } from "../../modules/document/domain/entities/document.entity";
import type { DocumentChunk } from "../../modules/document/domain/entities/document-chunk.entity";
import type { DocumentGeneration } from "../../modules/document/domain/entities/document-generation.entity";
import type { DocumentProcessingJob } from "../../modules/document/domain/entities/document-processing-job.entity";

export interface DocumentRepository {
  findByIdAndUserId(id: UUID, userId: UUID): Promise<Document | null>;
  findByUserId(userId: UUID, limit?: number): Promise<Document[]>;
  insert(entity: Document): Promise<void>;
  save(entity: Document, expectedRevision: number): Promise<boolean>;
  startGeneration(
    id: UUID,
    userId: UUID,
    expectedRevision: number,
    jobId: UUID,
    at: Date,
  ): Promise<number | null>;
  activateGeneration(
    id: UUID,
    userId: UUID,
    generation: number,
    expectedRevision: number,
    at: Date,
  ): Promise<boolean>;
}
export interface DocumentChunkRepository {
  findByDocumentAndUserId(
    id: UUID,
    userId: UUID,
    generation: number,
    limit?: number,
  ): Promise<DocumentChunk[]>;
  insert(entity: DocumentChunk, userId: UUID): Promise<void>;
}
export interface DocumentGenerationRepository {
  findByDocumentAndUserId(
    documentId: UUID,
    userId: UUID,
    generation: number,
  ): Promise<DocumentGeneration | null>;
}
export interface DocumentProcessingJobRepository {
  findByDocumentAndUserId(
    documentId: UUID,
    userId: UUID,
    generation: number,
  ): Promise<DocumentProcessingJob | null>;
}
export interface DocumentEmbeddingMetadata {
  id: UUID;
  chunkId: UUID;
  embeddingModel: string;
  modelVersion: string;
  dimensions: number;
  createdAt: Date;
}
export interface DocumentEmbeddingRepository {
  insertMetadata(
    entity: DocumentEmbeddingMetadata,
    userId: UUID,
  ): Promise<void>;
  findByChunkAndUserId(
    chunkId: UUID,
    userId: UUID,
  ): Promise<DocumentEmbeddingMetadata | null>;
}
export const DOCUMENT_REPOSITORY = Symbol("DOCUMENT_REPOSITORY");
export const DOCUMENT_CHUNK_REPOSITORY = Symbol("DOCUMENT_CHUNK_REPOSITORY");
export const DOCUMENT_GENERATION_REPOSITORY = Symbol(
  "DOCUMENT_GENERATION_REPOSITORY",
);
export const DOCUMENT_PROCESSING_JOB_REPOSITORY = Symbol(
  "DOCUMENT_PROCESSING_JOB_REPOSITORY",
);
export const DOCUMENT_EMBEDDING_REPOSITORY = Symbol(
  "DOCUMENT_EMBEDDING_REPOSITORY",
);
