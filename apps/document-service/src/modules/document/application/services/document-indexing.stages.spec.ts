import { DocumentIndexingStages } from "./document-indexing.stages";
import { DocumentChunk } from "../../domain/entities/document-chunk.entity";
import type {
  ProcessingLease,
  PreparedExtraction,
} from "../ports/document-processing.port";
import { FakeEmbeddingProvider } from "../../../../testing/fake-embedding.provider";
import { validateEmbeddingResult } from "./embedding-validation";
const space = { model: "fixture", version: "fake-v1", dimensions: 2 };
const extracted: PreparedExtraction = {
  kind: "extracted",
  processingVersion: "v1",
  sourceChecksumSha256: "a".repeat(64),
  sourceVersionId: "source-v1",
  chunks: [0, 1, 2].map((i) =>
    DocumentChunk.create({
      id: `chunk-${i}`,
      documentId: "doc",
      generation: 1,
      chunkIndex: i,
      content: `Đoạn tiếng Việt ${i}`,
      tokenCount: 20,
      locator: { kind: "LINE", start: i + 1, end: i + 1 },
    }),
  ),
};
function fixture() {
  const fake = new FakeEmbeddingProvider();
  const embed = jest.fn(fake.embed.bind(fake));
  const stages = new DocumentIndexingStages(
    { available: true, prepare: jest.fn() },
    { embed },
    { space, batchSize: 2, maxInputTokens: 128 },
  );
  return { stages, embed };
}
it("embeds all chunks in bounded ordered batches with reproducible space/settings", async () => {
  const { stages, embed } = fixture();
  const result = await stages.index(
    {} as ProcessingLease,
    extracted,
    new AbortController().signal,
    () => undefined,
  );
  expect(embed.mock.calls.map((c) => c[0].items.map((i) => i.id))).toEqual([
    ["chunk-0", "chunk-1"],
    ["chunk-2"],
  ]);
  expect(result.embeddings.map((e) => e.state.chunkId)).toEqual([
    "chunk-0",
    "chunk-1",
    "chunk-2",
  ]);
  expect(result.embeddingSettings).toMatchObject({
    inputPolicy: "plain-text-v1",
    batchSize: 2,
  });
  const repeated = await stages.index(
    {} as ProcessingLease,
    extracted,
    new AbortController().signal,
    () => undefined,
  );
  expect(repeated.embeddings.map((e) => e.state.embedding)).toEqual(
    result.embeddings.map((e) => e.state.embedding),
  );
});
it("does not return a partially embedded generation when a later batch fails", async () => {
  const { stages, embed } = fixture();
  embed
    .mockResolvedValueOnce(
      await new FakeEmbeddingProvider().embed(
        {
          space,
          items: extracted.chunks
            .slice(0, 2)
            .map((c) => ({ id: c.state.id, text: c.state.content })),
        },
        new AbortController().signal,
      ),
    )
    .mockRejectedValueOnce(new Error("unavailable"));
  await expect(
    stages.index(
      {} as ProcessingLease,
      extracted,
      new AbortController().signal,
      () => undefined,
    ),
  ).rejects.toThrow("unavailable");
});
it.each(["order", "dimension", "nan", "space"])(
  "rejects incompatible %s provider output",
  (mode) => {
    const request = { space, items: [{ id: "one", text: "text" }] };
    const result = {
      space: mode === "space" ? { ...space, version: "v2" } : space,
      items: [
        {
          id: mode === "order" ? "other" : "one",
          vector:
            mode === "nan" ? [NaN, 1] : mode === "dimension" ? [1] : [1, 0],
        },
      ],
    };
    expect(() => validateEmbeddingResult(request, result)).toThrow(
      /^DOCUMENT_EMBEDDING_/,
    );
  },
);
