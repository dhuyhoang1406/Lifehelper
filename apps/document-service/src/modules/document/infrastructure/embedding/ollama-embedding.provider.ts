import { embeddingJson, embeddingWithRetry } from "./embedding-http";
import type {
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResult,
  EmbeddingSpace,
} from "../../application/ports/embedding-provider.port";
import {
  validateEmbeddingRequest,
  validateEmbeddingResult,
} from "../../application/services/embedding-validation";
import { DocumentProcessingFailure } from "../../domain/processing-policy";
export interface OllamaEmbeddingConfig {
  baseUrl: string;
  space: EmbeddingSpace;
  batchSize: number;
  maxInputTokens: number;
  timeoutMs: number;
  maxAttempts: number;
}
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private readonly base: URL;
  constructor(private readonly config: OllamaEmbeddingConfig) {
    this.base = new URL(config.baseUrl);
    if (
      !["http:", "https:"].includes(this.base.protocol) ||
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash ||
      this.base.pathname !== "/"
    )
      throw new Error("Invalid embedding base URL");
  }
  private async verifyModel(signal: AbortSignal) {
    const tags = await embeddingJson(
      new URL("/api/tags", this.base),
      signal,
      1024 * 1024,
    );
    const models = tags.models;
    if (!Array.isArray(models))
      throw new DocumentProcessingFailure("DOCUMENT_EMBEDDING_RESULT_INVALID");
    const installed = models.find(
      (model) => model && model.name === this.config.space.model,
    );
    if (!installed)
      throw new DocumentProcessingFailure("DOCUMENT_EMBEDDING_UNAVAILABLE");
    if (installed.digest !== this.config.space.version)
      throw new DocumentProcessingFailure("DOCUMENT_EMBEDDING_MODEL_MISMATCH");
  }
  async embed(
    request: EmbeddingRequest,
    signal: AbortSignal,
  ): Promise<EmbeddingResult> {
    validateEmbeddingRequest(request, this.config);
    return embeddingWithRetry(this.config, signal, async (bounded) => {
      await this.verifyModel(bounded);
      const payload = await embeddingJson(
        new URL("/api/embed", this.base),
        bounded,
        4096 + request.items.length * this.config.space.dimensions * 32,
        {
          model: this.config.space.model,
          input: request.items.map((i) => i.text),
          truncate: false,
          options: { num_ctx: this.config.maxInputTokens },
          keep_alive: "5m",
        },
      );
      if (
        payload.model !== this.config.space.model ||
        !Array.isArray(payload.embeddings)
      )
        throw new DocumentProcessingFailure(
          "DOCUMENT_EMBEDDING_RESULT_INVALID",
        );
      const vectors = payload.embeddings as readonly (readonly number[])[];
      if (vectors.length !== request.items.length)
        throw new DocumentProcessingFailure(
          "DOCUMENT_EMBEDDING_RESULT_INVALID",
        );
      const result: EmbeddingResult = {
        space: { ...this.config.space },
        items: request.items.map((item, i) => ({
          id: item.id,
          vector: vectors[i],
        })),
      };
      validateEmbeddingResult(request, result);
      await this.verifyModel(bounded);
      return result;
    });
  }
}
