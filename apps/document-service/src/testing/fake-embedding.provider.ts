import { createHash } from "node:crypto";
import type {
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResult,
} from "../modules/document/application/ports/embedding-provider.port";
import { DocumentProcessingFailure } from "../modules/document/domain/processing-policy";
// Test double only: stable vectors, no semantic-quality claim, never a runtime fallback.
export class FakeEmbeddingProvider implements EmbeddingProvider {
  async embed(
    request: EmbeddingRequest,
    signal: AbortSignal,
  ): Promise<EmbeddingResult> {
    if (signal.aborted)
      throw new DocumentProcessingFailure("DOCUMENT_EMBEDDING_TIMEOUT");
    return {
      space: { ...request.space },
      items: request.items.map((item) => {
        const hash = createHash("sha256").update(item.text).digest();
        const vector = Array.from(
          { length: request.space.dimensions },
          (_, i) => (hash[i % hash.length] + 1) / 256,
        );
        const norm = Math.hypot(...vector);
        return { id: item.id, vector: vector.map((v) => v / norm) };
      }),
    };
  }
}
