import { DocumentGeneration } from "./document-generation.entity";
const identity = {
  processingVersion: "extraction-v1/test",
  sourceChecksumSha256: "a".repeat(64),
  sourceVersionId: "immutable-v1",
};
it("records verified extraction without completing the generation or retaining unrelated stage data", () => {
  const generation = DocumentGeneration.create("document", 1);
  const at = new Date("2026-10-08T01:00:00Z");
  generation.extract(
    2,
    { ...identity, chunks: ["untrusted extra"] } as typeof identity,
    at,
  );
  expect(generation.state).toMatchObject({
    ...identity,
    status: "EXTRACTED",
    chunkCount: 2,
    extractedAt: at,
    completedAt: null,
  });
  expect(generation.state).not.toHaveProperty("chunks");
  generation.complete(2, at);
  expect(generation.state.status).toBe("COMPLETE");
});
it("allows deletion/failure of staged results but rejects invalid or repeated extraction", () => {
  const generation = DocumentGeneration.create("document", 1);
  expect(() => generation.extract(0, identity)).toThrow();
  expect(() =>
    generation.extract(1, { ...identity, sourceChecksumSha256: "invalid" }),
  ).toThrow();
  generation.extract(1, identity);
  expect(() => generation.extract(1, identity)).toThrow();
  generation.fail();
  expect(generation.state.status).toBe("FAILED");
});
