import { Document } from "./document.entity";
import { DocumentChunk } from "./document-chunk.entity";
import { DocumentGeneration } from "./document-generation.entity";
import { DocumentProcessingJob } from "./document-processing-job.entity";
const input = {
  id: "doc",
  userId: "owner",
  originalFilename: "a.txt",
  storageFilename: "a.txt",
  mimeType: "text/plain",
  sizeBytes: 1n,
  s3Bucket: "private",
  s3Key: "key",
};
it("requires the current generation, supports retry and makes deletion terminal", () => {
  const d = Document.create(input);
  expect(() => d.markFailed("FAILED")).toThrow();
  d.markUploaded();
  d.startProcessing();
  const g = DocumentGeneration.create("doc", 2);
  expect(() => d.markReady(g)).toThrow();
  d.markFailed("EXTRACTION_FAILED");
  d.startProcessing();
  g.complete(1);
  d.markReady(g);
  expect(d.state.activeGeneration).toBe(2);
  d.startProcessing();
  expect(d.state.activeGeneration).toBe(2);
  expect(() => d.markFailed("private error body")).toThrow();
  d.delete();
  expect(d.state.activeGeneration).toBeNull();
  expect(() => d.startProcessing()).toThrow();
  expect(() => d.markFailed("FAILED")).toThrow();
});
it("validates checksums, source locators and integer token counts", () => {
  expect(() => Document.create({ ...input, checksumSha256: "bad" })).toThrow();
  const chunk = {
    id: "chunk",
    documentId: "doc",
    chunkIndex: 0,
    content: "text",
  };
  expect(() => DocumentChunk.create({ ...chunk, tokenCount: 1.5 })).toThrow();
  expect(() => DocumentChunk.create({ ...chunk, generation: 0 })).toThrow();
  expect(() =>
    DocumentChunk.create({
      ...chunk,
      locator: { kind: "LINE", start: 3, end: 2 },
    }),
  ).toThrow();
});
it("prevents empty or repeated generation completion", () => {
  const g = DocumentGeneration.create("doc", 1);
  expect(() => g.complete(0)).toThrow();
  g.complete(2);
  expect(() => g.complete(2)).toThrow();
  expect(() => g.fail()).toThrow();
});
it("validates job leases and sanitized errors", () => {
  const at = new Date("2026-10-01T01:00:00Z");
  const j = DocumentProcessingJob.create("job", "doc", 1, at);
  expect(() => j.claim("worker", at, at)).toThrow();
  j.claim("worker", new Date(at.getTime() + 1000), at);
  expect(() => j.claim("worker", new Date(at.getTime() + 1000), at)).toThrow();
  expect(() => j.finish("FAILED", "secret text", at)).toThrow();
  j.finish("FAILED", "EXTRACTION_FAILED", at);
  expect(j.state.leaseOwner).toBeNull();
  expect(j.state.attemptCount).toBe(1);
});
