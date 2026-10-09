import { randomUUID } from "node:crypto";
import type {
  DocumentProcessingStages,
  ProcessingLease,
  PreparedExtraction,
  PreparedGeneration,
} from "../ports/document-processing.port";
import type {
  EmbeddingProvider,
  EmbeddingLimits,
} from "../ports/embedding-provider.port";
import { validateEmbeddingResult } from "./embedding-validation";
import { estimateTokens } from "../../domain/text-chunking";
import { DocumentProcessingFailure } from "../../domain/processing-policy";
import { DocumentEmbedding } from "../../domain/entities/document-embedding.entity";
export class DocumentIndexingStages implements DocumentProcessingStages {
  readonly available = true;
  constructor(
    private readonly extraction: DocumentProcessingStages,
    private readonly provider: EmbeddingProvider,
    private readonly limits: EmbeddingLimits,
  ) {}
  prepare(
    lease: ProcessingLease,
    bytes: Uint8Array,
    signal: AbortSignal,
    checkpoint: () => void,
  ) {
    return this.extraction.prepare(lease, bytes, signal, checkpoint);
  }
  async index(
    _lease: ProcessingLease,
    extraction: PreparedExtraction,
    signal: AbortSignal,
    checkpoint: () => void,
  ): Promise<PreparedGeneration> {
    const embeddings: DocumentEmbedding[] = [];
    for (
      let start = 0;
      start < extraction.chunks.length;
      start += this.limits.batchSize
    ) {
      checkpoint();
      const chunks = extraction.chunks.slice(
        start,
        start + this.limits.batchSize,
      );
      const items = chunks.map((chunk) => {
        if (estimateTokens(chunk.state.content) > this.limits.maxInputTokens)
          throw new DocumentProcessingFailure("DOCUMENT_EMBEDDING_INPUT_LIMIT");
        return { id: chunk.state.id, text: chunk.state.content };
      });
      const request = { space: this.limits.space, items };
      const result = await this.provider.embed(request, signal);
      checkpoint();
      validateEmbeddingResult(request, result);
      embeddings.push(
        ...result.items.map((item) =>
          DocumentEmbedding.create({
            id: randomUUID(),
            chunkId: item.id,
            embeddingModel: result.space.model,
            modelVersion: result.space.version,
            dimensions: result.space.dimensions,
            embedding: item.vector,
          }),
        ),
      );
    }
    checkpoint();
    return {
      chunks: extraction.chunks,
      embeddings,
      embeddingSettings: {
        batchSize: this.limits.batchSize,
        maxInputTokens: this.limits.maxInputTokens,
        inputPolicy: "plain-text-v1",
        tokenEstimator: "utf8-byte-upper-bound-v1",
      },
    };
  }
}
