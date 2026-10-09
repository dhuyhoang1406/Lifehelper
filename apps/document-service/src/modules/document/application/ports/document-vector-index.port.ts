import type { EmbeddingSpace } from "./embedding-provider.port";
export interface VectorQuery {
  userId: string;
  space: EmbeddingSpace;
  vector: readonly number[];
  topK: number;
}
export interface VectorMatch {
  documentId: string;
  chunkId: string;
  chunkIndex: number;
  distance: number;
}
// Exact cosine search only. The authenticated retrieval API is introduced in Branch 6.
export interface DocumentVectorIndex {
  search(query: VectorQuery): Promise<readonly VectorMatch[]>;
}
