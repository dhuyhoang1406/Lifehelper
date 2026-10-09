import type {
  EmbeddingProvider,
  EmbeddingSpace,
} from "../ports/embedding-provider.port";
import type { DocumentVectorIndex } from "../ports/document-vector-index.port";
import type { DocumentRetrievalRepository } from "../ports/document-retrieval.repository";
import { validateEmbeddingResult } from "../services/embedding-validation";
import {
  DocumentApplicationError,
  documentNotFound,
} from "../errors/document.errors";
import { DocumentProcessingFailure } from "../../domain/processing-policy";
export class DocumentRetrievalUseCases {
  constructor(
    private readonly repository: DocumentRetrievalRepository,
    private readonly index: DocumentVectorIndex,
    private readonly provider: EmbeddingProvider,
    private readonly settings: {
      space: EmbeddingSpace;
      timeoutMs: number;
      minSimilarity: number;
    },
  ) {}
  async search(
    userId: string,
    input: { query: string; topK: number; documentIds?: string[] },
  ) {
    if (
      !input.query.trim() ||
      input.query.length > 1000 ||
      !Number.isInteger(input.topK) ||
      input.topK < 1 ||
      input.topK > 20
    )
      throw new DocumentApplicationError(
        "DOCUMENT_SEARCH_INVALID",
        "Invalid search input",
        400,
      );
    if (input.documentIds !== undefined) {
      if (!(await this.repository.ownsAll(userId, input.documentIds)))
        throw documentNotFound();
      if (input.documentIds.length === 0) return { items: [] };
    }
    const request = {
      space: this.settings.space,
      items: [{ id: "query", text: input.query.trim() }],
    };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.provider.embed(request, controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new DocumentProcessingFailure("DOCUMENT_EMBEDDING_TIMEOUT"));
          }, this.settings.timeoutMs);
        }),
      ]);
      validateEmbeddingResult(request, result);
      const matches = await this.index.search({
        userId,
        space: request.space,
        vector: result.items[0].vector,
        topK: input.topK,
        documentIds: input.documentIds,
      });
      return {
        items: matches
          .filter(
            (m) =>
              Number.isFinite(m.distance) &&
              1 - m.distance >= this.settings.minSimilarity,
          )
          .map(({ distance, ...match }) => ({
            ...match,
            similarity: Math.max(-1, Math.min(1, 1 - distance)),
          })),
      };
    } catch (error) {
      if (!(error instanceof DocumentProcessingFailure)) throw error;
      const statuses: Record<string, number> = {
        DOCUMENT_EMBEDDING_TIMEOUT: 504,
        DOCUMENT_EMBEDDING_QUOTA: 429,
        DOCUMENT_EMBEDDING_INPUT_LIMIT: 400,
        DOCUMENT_EMBEDDING_UNAVAILABLE: 503,
        DOCUMENT_EMBEDDING_MODEL_MISMATCH: 503,
        DOCUMENT_EMBEDDING_RESULT_INVALID: 502,
      };
      throw new DocumentApplicationError(
        error.code,
        "Document retrieval embedding failed",
        statuses[error.code] ?? 503,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async chunks(
    userId: string,
    documentId: string,
    input: { generation?: number; after: number; limit: number },
  ) {
    if (input.after >= 0 && input.generation === undefined)
      throw new DocumentApplicationError(
        "DOCUMENT_CURSOR_INVALID",
        "Continuation requires generation",
        400,
      );
    const rows = await this.repository.chunks(
      userId,
      documentId,
      input.generation,
      input.after,
      input.limit + 1,
    );
    if (!rows.length) {
      // Empty pages must not expose foreign/nonready/deleted documents.
      const first = await this.repository.chunks(
        userId,
        documentId,
        input.generation,
        -1,
        1,
      );
      if (!first.length) throw documentNotFound();
      return { items: [], next: null };
    }
    const items = [];
    let chars = 0;
    for (const row of rows.slice(0, input.limit)) {
      if (chars + row.content.length > 32768) break;
      items.push(row);
      chars += row.content.length;
    }
    if (!items.length)
      throw new DocumentApplicationError(
        "DOCUMENT_CHUNK_LIMIT",
        "Chunk exceeds response text budget",
        413,
      );
    const last = items[items.length - 1];
    return {
      items,
      next:
        rows.length > items.length
          ? { generation: last.generation, after: last.chunkIndex }
          : null,
    };
  }
  async chunk(
    userId: string,
    documentId: string,
    chunkId: string,
    generation?: number,
  ) {
    const [row] = await this.repository.chunks(
      userId,
      documentId,
      generation,
      -1,
      1,
      chunkId,
    );
    if (!row) throw documentNotFound();
    if (row.content.length > 32768)
      throw new DocumentApplicationError(
        "DOCUMENT_CHUNK_LIMIT",
        "Chunk exceeds response text budget",
        413,
      );
    return row;
  }
}
