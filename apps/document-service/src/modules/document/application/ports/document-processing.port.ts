import type { DocumentChunk } from "../../domain/entities/document-chunk.entity";
import type { DocumentEmbedding } from "../../domain/entities/document-embedding.entity";
import type { ProcessingFailureCode } from "../../domain/processing-policy";
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
export interface PreparedExtraction {
  kind: "extracted";
  chunks: readonly DocumentChunk[];
  processingVersion: string;
  sourceChecksumSha256: string;
  sourceVersionId: string;
}
export interface DocumentProcessingStages {
  readonly available: boolean;
  prepare(
    lease: ProcessingLease,
    bytes: Uint8Array,
    signal: AbortSignal,
    checkpoint: () => void,
  ): Promise<PreparedGeneration | PreparedExtraction>;
}
export interface DocumentProcessingRepository {
  claim(owner: string): Promise<ProcessingLease | null>;
  publish(lease: ProcessingLease, result: PreparedGeneration): Promise<boolean>;
  stageExtraction(
    lease: ProcessingLease,
    result: PreparedExtraction,
  ): Promise<boolean>;
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
