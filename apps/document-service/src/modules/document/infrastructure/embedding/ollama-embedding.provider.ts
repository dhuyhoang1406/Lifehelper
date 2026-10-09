import { setTimeout as delay } from "node:timers/promises";
import type {
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResult,
  EmbeddingSpace,
} from "../../application/ports/embedding-provider.port";
import {
  sameEmbeddingSpace,
  validateEmbeddingResult,
} from "../../application/services/embedding-validation";
import { estimateTokens } from "../../domain/text-chunking";
import {
  DocumentProcessingFailure,
  processingFailure,
  processingFailures,
} from "../../domain/processing-policy";
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
  private async json(
    path: string,
    signal: AbortSignal,
    maximumBytes: number,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(new URL(path, this.base), {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      signal,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new DocumentProcessingFailure(
        response.status === 429
          ? "DOCUMENT_EMBEDDING_QUOTA"
          : response.status >= 500
            ? "DOCUMENT_EMBEDDING_UNAVAILABLE"
            : response.status === 404
              ? "DOCUMENT_EMBEDDING_MODEL_MISMATCH"
              : response.status === 400 || response.status === 413
                ? "DOCUMENT_EMBEDDING_INPUT_LIMIT"
                : "DOCUMENT_EMBEDDING_RESULT_INVALID",
      );
    }
    const reader = response.body?.getReader();
    if (!reader)
      throw new DocumentProcessingFailure("DOCUMENT_EMBEDDING_RESULT_INVALID");
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > maximumBytes)
          throw new DocumentProcessingFailure(
            "DOCUMENT_EMBEDDING_RESULT_INVALID",
          );
        parts.push(result.value);
      }
      const result: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
      if (!result || typeof result !== "object" || Array.isArray(result))
        throw new Error();
      return result as Record<string, unknown>;
    } catch (error) {
      if (error instanceof DocumentProcessingFailure || signal.aborted)
        throw error;
      throw new DocumentProcessingFailure("DOCUMENT_EMBEDDING_RESULT_INVALID");
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  private async verifyModel(signal: AbortSignal) {
    const tags = await this.json("/api/tags", signal, 1024 * 1024);
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
    if (!sameEmbeddingSpace(request.space, this.config.space))
      throw new DocumentProcessingFailure("DOCUMENT_EMBEDDING_MODEL_MISMATCH");
    if (
      !request.items.length ||
      request.items.length > this.config.batchSize ||
      new Set(request.items.map((i) => i.id)).size !== request.items.length ||
      request.items.some(
        (i) =>
          !i.id ||
          !i.text.trim() ||
          estimateTokens(i.text) > this.config.maxInputTokens,
      )
    )
      throw new DocumentProcessingFailure("DOCUMENT_EMBEDDING_INPUT_LIMIT");
    if (signal.aborted)
      throw new DocumentProcessingFailure("DOCUMENT_EMBEDDING_TIMEOUT");
    for (let attempt = 1; ; attempt++) {
      const timeout = AbortSignal.timeout(this.config.timeoutMs);
      const bounded = AbortSignal.any([signal, timeout]);
      try {
        await this.verifyModel(bounded);
        const payload = await this.json(
          "/api/embed",
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
      } catch (error) {
        const code =
          signal.aborted || timeout.aborted
            ? "DOCUMENT_EMBEDDING_TIMEOUT"
            : error instanceof DocumentProcessingFailure
              ? processingFailure(error)
              : "DOCUMENT_EMBEDDING_UNAVAILABLE";
        if (
          signal.aborted ||
          attempt >= this.config.maxAttempts ||
          !processingFailures[code]
        )
          throw new DocumentProcessingFailure(code);
        try {
          await delay(
            100 * attempt + Math.floor(Math.random() * 100),
            undefined,
            { signal },
          );
        } catch {
          throw new DocumentProcessingFailure("DOCUMENT_EMBEDDING_TIMEOUT");
        }
      }
    }
  }
}
