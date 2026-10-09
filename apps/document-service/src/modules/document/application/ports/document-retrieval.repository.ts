export interface RetrievedChunk {
  documentId: string;
  chunkId: string;
  generation: number;
  chunkIndex: number;
  filename: string;
  content: string;
  locator: { kind: string; start: number; end: number } | null;
}
export interface DocumentRetrievalRepository {
  ownsAll(userId: string, documentIds: readonly string[]): Promise<boolean>;
  chunks(
    userId: string,
    documentId: string,
    generation: number | undefined,
    after: number,
    limit: number,
    chunkId?: string,
  ): Promise<readonly RetrievedChunk[]>;
}
