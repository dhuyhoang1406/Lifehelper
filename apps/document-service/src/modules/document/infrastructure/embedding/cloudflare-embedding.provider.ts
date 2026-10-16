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
import { embeddingJson, embeddingWithRetry } from "./embedding-http";

export interface CloudflareEmbeddingConfig {
  baseUrl: string;
  accountId: string;
  apiToken: string;
  space: EmbeddingSpace;
  batchSize: number;
  maxInputTokens: number;
  timeoutMs: number;
  maxAttempts: number;
}

export class CloudflareEmbeddingProvider implements EmbeddingProvider {
  private readonly endpoint: URL;
  constructor(private readonly config: CloudflareEmbeddingConfig) {
    const origin = new URL(config.baseUrl);
    if (
      origin.origin !== "https://api.cloudflare.com" ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      origin.username ||
      origin.password ||
      !/^[a-f0-9]{32}$/.test(config.accountId) ||
      !config.apiToken ||
      /\s/.test(config.apiToken)
    )
      throw new Error("Invalid Cloudflare embedding connection configuration");
    if (
      config.space.model !== "@cf/baai/bge-m3" ||
      config.space.dimensions !== 1024 ||
      !/^cloudflare-bge-m3-[a-z0-9][a-z0-9._-]*$/.test(config.space.version)
    )
      throw new Error("Invalid Cloudflare embedding space configuration");
    this.endpoint = new URL(
      `/client/v4/accounts/${config.accountId}/ai/run/${config.space.model}`,
      origin,
    );
  }

  async embed(
    request: EmbeddingRequest,
    signal: AbortSignal,
  ): Promise<EmbeddingResult> {
    validateEmbeddingRequest(request, this.config);
    return embeddingWithRetry(this.config, signal, async (bounded) => {
      const payload = await embeddingJson(
        this.endpoint,
        bounded,
        16384 + request.items.length * request.space.dimensions * 32,
        {
          text: request.items.map((item) => item.text),
          truncate_inputs: false,
        },
        { Authorization: `Bearer ${this.config.apiToken}` },
      );
      const result = payload.result;
      if (
        payload.success !== true ||
        (payload.errors !== undefined &&
          (!Array.isArray(payload.errors) || payload.errors.length)) ||
        !result ||
        typeof result !== "object" ||
        Array.isArray(result)
      )
        throw new DocumentProcessingFailure(
          "DOCUMENT_EMBEDDING_RESULT_INVALID",
        );
      const value = result as Record<string, unknown>;
      if (
        !Array.isArray(value.shape) ||
        value.shape.length !== 2 ||
        value.shape[0] !== request.items.length ||
        value.shape[1] !== request.space.dimensions ||
        !Array.isArray(value.data) ||
        value.data.length !== request.items.length
      )
        throw new DocumentProcessingFailure(
          "DOCUMENT_EMBEDDING_RESULT_INVALID",
        );
      const vectors = value.data as readonly (readonly number[])[];
      const response = {
        space: { ...this.config.space },
        items: request.items.map((item, i) => ({
          id: item.id,
          vector: vectors[i],
        })),
      };
      validateEmbeddingResult(request, response);
      return response;
    });
  }
}
