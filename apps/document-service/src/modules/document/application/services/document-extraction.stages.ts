import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
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
import { DocumentProcessingFailure } from "../../domain/processing-policy";
export const EXTRACTION_VERSION = `extraction-v1/${TOKEN_ESTIMATOR_VERSION}`;
export class DocumentExtractionStages implements DocumentProcessingStages {
  readonly available = true;
  constructor(
    private readonly extractor: DocumentTextExtractor,
    private readonly limits: ChunkingLimits,
    private readonly timeoutMs: number,
  ) {}
  async prepare(
    lease: ProcessingLease,
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<PreparedExtraction> {
    const extracted = await this.extractor.extract(
      bytes,
      lease.source.mimeType,
      signal,
    );
    const started = performance.now();
    const chunks = chunkText(
      extracted.units,
      extracted.locatorKind,
      this.limits,
      () => {
        if (signal.aborted || performance.now() - started >= this.timeoutMs)
          throw new DocumentProcessingFailure("DOCUMENT_PROCESSING_TIMEOUT");
      },
    ).map((chunk, index) =>
      DocumentChunk.create({
        id: randomUUID(),
        documentId: lease.documentId,
        generation: lease.generation,
        chunkIndex: index,
        ...chunk,
      }),
    );
    return {
      kind: "extracted",
      chunks,
      processingVersion: `${EXTRACTION_VERSION}/t${this.limits.targetTokens}/o${this.limits.overlapTokens}`,
      sourceChecksumSha256: lease.source.checksumSha256,
      sourceVersionId: lease.source.versionId,
    };
  }
}
