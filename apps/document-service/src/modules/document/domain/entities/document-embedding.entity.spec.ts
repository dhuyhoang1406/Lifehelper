import { DocumentEmbedding } from "./document-embedding.entity";

describe("DocumentEmbedding", () => {
  const input = {
    id: "embedding-id",
    chunkId: "chunk-id",
    embeddingModel: "text-embedding-model",
    embedding: [0.1, 0.2],
  };

  it("requires a model and non-empty vector", () => {
    expect(() =>
      DocumentEmbedding.create({ ...input, embeddingModel: " " }),
    ).toThrow("required");
    expect(() => DocumentEmbedding.create({ ...input, embedding: [] })).toThrow(
      "required",
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects non-finite vector value %p",
    (value) => {
      expect(() =>
        DocumentEmbedding.create({ ...input, embedding: [value] }),
      ).toThrow("required");
    },
  );
});
