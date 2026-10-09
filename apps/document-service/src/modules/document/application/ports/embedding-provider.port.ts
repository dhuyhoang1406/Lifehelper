export interface EmbeddingSpace {
  model: string;
  version: string;
  dimensions: number;
}
export interface EmbeddingRequest {
  space: EmbeddingSpace;
  items: readonly { id: string; text: string }[];
}
export interface EmbeddingResult {
  space: EmbeddingSpace;
  items: readonly { id: string; vector: readonly number[] }[];
}
export interface EmbeddingProvider {
  embed(
    request: EmbeddingRequest,
    signal: AbortSignal,
  ): Promise<EmbeddingResult>;
}
export interface EmbeddingLimits {
  space: EmbeddingSpace;
  batchSize: number;
  maxInputTokens: number;
}
export const EMBEDDING_PROVIDER = Symbol("EMBEDDING_PROVIDER");
