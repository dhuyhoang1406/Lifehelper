import type { EmbeddingSpace } from "./embedding-provider.port";
export interface VectorQuery {
  userId: string;
  space: EmbeddingSpace;
  vector: readonly number[];
  topK: number;
  documentIds?: readonly string[];
}
export interface VectorMatch {
  documentId: string;
  chunkId: string;
  chunkIndex: number;
  distance: number;
  generation: number;
  filename: string;
  excerpt: string;
  locator: { kind: string; start: number; end: number } | null;
}
// Exact cosine search within the current authorized embedding space.
export interface DocumentVectorIndex {
  search(query: VectorQuery): Promise<readonly VectorMatch[]>;
}
