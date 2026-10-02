import type { DocumentChunk } from "../../modules/document/domain/entities/document-chunk.entity";
import type { DocumentEmbedding } from "../../modules/document/domain/entities/document-embedding.entity";
import type { ProcessingFailureCode } from "../../modules/document/domain/processing-policy";
export interface ProcessingLease {
  id: string;
  documentId: string;
  generation: number;
  owner: string;
  token: number;
  attemptCount: number;
  expiresAt: Date;
  source: {
    bucket: string;
    key: string;
    versionId: string;
    checksumSha256: string;
    sizeBytes: bigint;
    mimeType: string;
    filename: string;
  };
}
// Stages prepare results outside a transaction. Only the fenced publisher persists them.
export interface PreparedGeneration {
  chunks: readonly DocumentChunk[];
  embeddings: readonly DocumentEmbedding[];
}
export interface DocumentProcessingStages {
  readonly available: boolean;
  prepare(
    lease: ProcessingLease,
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<PreparedGeneration>;
}
export interface DocumentProcessingRepository {
  claim(owner: string): Promise<ProcessingLease | null>;
  publish(lease: ProcessingLease, result: PreparedGeneration): Promise<boolean>;
  fail(lease: ProcessingLease, code: ProcessingFailureCode): Promise<boolean>;
  retry(
    documentId: string,
    userId: string,
  ): Promise<{
    documentId: string;
    jobId: string;
    generation: number;
    status: "PENDING";
  }>;
}
export const DOCUMENT_PROCESSING_REPOSITORY = Symbol(
  "DOCUMENT_PROCESSING_REPOSITORY",
);
export const DOCUMENT_PROCESSING_STAGES = Symbol("DOCUMENT_PROCESSING_STAGES");
