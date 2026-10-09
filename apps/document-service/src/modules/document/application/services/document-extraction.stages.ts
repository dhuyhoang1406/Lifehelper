import { randomUUID } from "node:crypto";
import type {
  DocumentProcessingStages,
  PreparedExtraction,
  ProcessingLease,
} from "../ports/document-processing.port";
import type { DocumentTextExtractor } from "../ports/document-extraction.port";
import {
  chunkText,
  TOKEN_ESTIMATOR_VERSION,
  type ChunkingLimits,
} from "../../domain/text-chunking";
import { DocumentChunk } from "../../domain/entities/document-chunk.entity";
export const EXTRACTION_VERSION = `extraction-v1/${TOKEN_ESTIMATOR_VERSION}`;
export class DocumentExtractionStages implements DocumentProcessingStages {
  readonly available = true;
  constructor(
    private readonly extractor: DocumentTextExtractor,
    private readonly limits: ChunkingLimits,
  ) {}
  async prepare(
    lease: ProcessingLease,
    bytes: Uint8Array,
    signal: AbortSignal,
    checkpoint: () => void,
  ): Promise<PreparedExtraction> {
    checkpoint();
    const extracted = await this.extractor.extract(
      bytes,
      lease.source.mimeType,
      signal,
    );
    checkpoint();
    const chunks = chunkText(
      extracted.units,
      extracted.locatorKind,
      this.limits,
      checkpoint,
    ).map((chunk, index) =>
      DocumentChunk.create({
        id: randomUUID(),
        documentId: lease.documentId,
        generation: lease.generation,
        chunkIndex: index,
        ...chunk,
      }),
    );
    checkpoint();
    return {
      kind: "extracted",
      chunks,
      processingVersion: `${EXTRACTION_VERSION}/t${this.limits.targetTokens}/o${this.limits.overlapTokens}`,
      sourceChecksumSha256: lease.source.checksumSha256,
      sourceVersionId: lease.source.versionId,
    };
  }
}
