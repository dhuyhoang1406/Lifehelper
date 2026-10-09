import { DocumentRetrievalUseCases } from "./document-retrieval.use-cases";
import type {
  DocumentRetrievalRepository,
  RetrievedChunk,
} from "../ports/document-retrieval.repository";
import type { DocumentVectorIndex } from "../ports/document-vector-index.port";
import type { EmbeddingProvider } from "../ports/embedding-provider.port";
import { DocumentProcessingFailure } from "../../domain/processing-policy";
const space = { model: "fixture", version: "v1", dimensions: 2 };
describe("Authorized document retrieval", () => {
  let repository: jest.Mocked<DocumentRetrievalRepository>;
  let index: jest.Mocked<DocumentVectorIndex>;
  let provider: jest.Mocked<EmbeddingProvider>;
  let retrieval: DocumentRetrievalUseCases;
  const row: RetrievedChunk = {
    documentId: "doc",
    chunkId: "chunk",
    generation: 2,
    chunkIndex: 0,
    filename: "notes.txt",
    content: "Nội dung",
    locator: { kind: "LINE", start: 1, end: 1 },
  };
  beforeEach(() => {
    repository = {
      ownsAll: jest.fn().mockResolvedValue(true),
      chunks: jest.fn().mockResolvedValue([row]),
    };
    index = {
      search: jest
        .fn()
        .mockResolvedValue([{ ...row, excerpt: row.content, distance: 0.2 }]),
    };
    provider = {
      embed: jest
        .fn()
        .mockResolvedValue({ space, items: [{ id: "query", vector: [1, 0] }] }),
    };
    retrieval = new DocumentRetrievalUseCases(repository, index, provider, {
      space,
      timeoutMs: 100,
      minSimilarity: 0.55,
    });
  });
  it("embeds the trimmed query, forwards owner/space/allowlist and returns similarity", async () => {
    const result = await retrieval.search("owner", {
      query: " hỏi ",
      topK: 2,
      documentIds: ["doc"],
    });
    expect(provider.embed).toHaveBeenCalledWith(
      { space, items: [{ id: "query", text: "hỏi" }] },
      expect.any(AbortSignal),
    );
    expect(index.search).toHaveBeenCalledWith({
      userId: "owner",
      space,
      vector: [1, 0],
      topK: 2,
      documentIds: ["doc"],
    });
    expect(result.items[0]).toMatchObject({
      generation: 2,
      similarity: 0.8,
      locator: row.locator,
    });
    expect(result.items[0]).not.toHaveProperty("distance");
  });
  it("rejects unauthorized requested documents before inference", async () => {
    repository.ownsAll.mockResolvedValue(false);
    await expect(
      retrieval.search("owner", {
        query: "hỏi",
        topK: 2,
        documentIds: ["foreign"],
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND", statusCode: 404 });
    expect(provider.embed).not.toHaveBeenCalled();
  });
  it("empty explicit document set and weak evidence return a stable empty result", async () => {
    expect(
      await retrieval.search("owner", {
        query: "hỏi",
        topK: 2,
        documentIds: [],
      }),
    ).toEqual({ items: [] });
    expect(provider.embed).not.toHaveBeenCalled();
    index.search.mockResolvedValue([
      { ...row, excerpt: "weak", distance: 0.8 },
    ]);
    expect(
      await retrieval.search("owner", { query: "unknown", topK: 2 }),
    ).toEqual({ items: [] });
  });
  it.each([
    ["DOCUMENT_EMBEDDING_TIMEOUT", 504],
    ["DOCUMENT_EMBEDDING_QUOTA", 429],
    ["DOCUMENT_EMBEDDING_UNAVAILABLE", 503],
    ["DOCUMENT_EMBEDDING_MODEL_MISMATCH", 503],
    ["DOCUMENT_EMBEDDING_RESULT_INVALID", 502],
    ["DOCUMENT_EMBEDDING_INPUT_LIMIT", 400],
  ] as const)("normalizes %s", async (code, statusCode) => {
    provider.embed.mockRejectedValue(new DocumentProcessingFailure(code));
    await expect(
      retrieval.search("owner", { query: "hỏi", topK: 1 }),
    ).rejects.toMatchObject({
      code,
      statusCode,
      message: "Document retrieval embedding failed",
    });
    expect(index.search).not.toHaveBeenCalled();
  });
  it("enforces deadline even for a provider that never settles", async () => {
    jest.useFakeTimers();
    try {
      provider.embed.mockImplementation(() => new Promise(() => {}));
      const result = expect(
        retrieval.search("owner", { query: "hỏi", topK: 1 }),
      ).rejects.toMatchObject({ statusCode: 504 });
      await jest.advanceTimersByTimeAsync(101);
      await result;
      expect(provider.embed.mock.calls[0][1].aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
  it("rejects incompatible query vectors before searching", async () => {
    provider.embed.mockResolvedValue({
      space: { ...space, version: "v2" },
      items: [{ id: "query", vector: [1, 0] }],
    });
    await expect(
      retrieval.search("owner", { query: "hỏi", topK: 1 }),
    ).rejects.toMatchObject({ code: "DOCUMENT_EMBEDDING_MODEL_MISMATCH" });
    expect(index.search).not.toHaveBeenCalled();
  });
  it("pins continuation generation and refuses unpinned cursors", async () => {
    await expect(
      retrieval.chunks("owner", "doc", { after: 0, limit: 10 }),
    ).rejects.toMatchObject({ code: "DOCUMENT_CURSOR_INVALID" });
    repository.chunks.mockResolvedValue([row, { ...row, chunkIndex: 1 }]);
    expect(
      await retrieval.chunks("owner", "doc", { after: -1, limit: 1 }),
    ).toMatchObject({ next: { generation: 2, after: 0 } });
  });
  it("bounds total text without truncating source chunks", async () => {
    repository.chunks.mockResolvedValue([
      { ...row, content: "a".repeat(20000) },
      { ...row, chunkIndex: 1, content: "b".repeat(20000) },
    ]);
    const result = await retrieval.chunks("owner", "doc", {
      after: -1,
      limit: 10,
    });
    expect(result.items).toHaveLength(1);
    expect(result.next).toEqual({ generation: 2, after: 0 });
  });
  it("uses safe not-found for unreadable chunks and rejects oversized chunks", async () => {
    repository.chunks.mockResolvedValue([]);
    await expect(
      retrieval.chunk("owner", "doc", "missing"),
    ).rejects.toMatchObject({ statusCode: 404 });
    repository.chunks.mockResolvedValue([
      { ...row, content: "a".repeat(32769) },
    ]);
    await expect(
      retrieval.chunk("owner", "doc", "chunk"),
    ).rejects.toMatchObject({ statusCode: 413 });
  });
});
