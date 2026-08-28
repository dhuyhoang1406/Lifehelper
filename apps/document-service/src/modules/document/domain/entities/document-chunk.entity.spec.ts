import { DocumentChunk } from "./document-chunk.entity";

describe("DocumentChunk", () => {
  const input = {
    id: "chunk-id",
    documentId: "document-id",
    chunkIndex: 0,
    content: "Extracted text",
  };

  it("rejects invalid chunk indexes", () => {
    expect(() => DocumentChunk.create({ ...input, chunkIndex: -1 })).toThrow(
      "non-negative integer",
    );
    expect(() => DocumentChunk.create({ ...input, chunkIndex: 1.5 })).toThrow(
      "non-negative integer",
    );
  });

  it("rejects blank content and negative token counts", () => {
    expect(() => DocumentChunk.create({ ...input, content: "" })).toThrow(
      "content",
    );
    expect(() => DocumentChunk.create({ ...input, tokenCount: -1 })).toThrow(
      "cannot be negative",
    );
  });
});
