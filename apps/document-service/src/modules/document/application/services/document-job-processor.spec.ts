import { performance } from "node:perf_hooks";
import { DocumentExtractionStages } from "./document-extraction.stages";
jest.mock("node:perf_hooks", () => {
  const actual = jest.requireActual("node:perf_hooks");
  return { performance: { now: jest.fn(() => actual.performance.now()) } };
});
afterEach(() =>
  jest
    .mocked(performance.now)
    .mockReset()
    .mockImplementation(() =>
      jest.requireActual("node:perf_hooks").performance.now(),
    ),
);
import { createHash } from "node:crypto";
import { DocumentJobProcessor } from "./document-job-processor";
import type {
  DocumentProcessingRepository,
  DocumentProcessingStages,
  ProcessingLease,
} from "../ports/document-processing.port";
import type { DocumentStorage } from "../ports/document-storage.port";
const bytes = Buffer.from("hello!");
const lease: ProcessingLease = {
  id: "job",
  documentId: "document",
  generation: 1,
  owner: "worker",
  token: 1,
  attemptCount: 1,
  expiresAt: new Date(Date.now() + 60000),
  source: {
    bucket: "private",
    key: "server-key",
    versionId: "committed-v1",
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: 6n,
    mimeType: "text/plain",
    filename: "notes.txt",
  },
};
function fixture() {
  const jobs: jest.Mocked<DocumentProcessingRepository> = {
    claim: jest.fn(),
    stageExtraction: jest.fn().mockResolvedValue(true),
    publish: jest.fn().mockResolvedValue(true),
    fail: jest.fn().mockResolvedValue(true),
    retry: jest.fn(),
  };
  const storage: jest.Mocked<DocumentStorage> = {
    authorizeUpload: jest.fn(),
    authorizeDownload: jest.fn(),
    readForVerification: jest.fn().mockResolvedValue({
      versionId: lease.source.versionId,
      checksumSha256: lease.source.checksumSha256,
      sizeBytes: 6,
      mimeType: "text/plain",
      bytes,
    }),
  };
  const stages: jest.Mocked<DocumentProcessingStages> = {
    available: true,
    prepare: jest.fn().mockResolvedValue({ chunks: [], embeddings: [] }),
  };
  return {
    jobs,
    storage,
    stages,
    processor: new DocumentJobProcessor(jobs, storage, stages, 64, 20),
  };
}
it("reads the committed version and delegates prepared output to the fenced publisher", async () => {
  const f = fixture();
  await f.processor.run(lease, new AbortController().signal);
  expect(f.storage.readForVerification).toHaveBeenCalledWith(
    lease.source,
    64,
    "committed-v1",
    expect.any(AbortSignal),
  );
  expect(f.stages.prepare).toHaveBeenCalledWith(
    lease,
    bytes,
    expect.any(AbortSignal),
    expect.any(Function),
  );
  expect(f.jobs.publish).toHaveBeenCalledWith(lease, {
    chunks: [],
    embeddings: [],
  });
  expect(f.jobs.fail).not.toHaveBeenCalled();
});
it("unavailable stages fail explicitly without reading sources or reporting READY", async () => {
  const f = fixture();
  const stages: DocumentProcessingStages = {
    available: false,
    prepare: jest.fn(),
  };
  await new DocumentJobProcessor(f.jobs, f.storage, stages, 64, 20).run(
    lease,
    new AbortController().signal,
  );
  expect(f.jobs.fail).toHaveBeenCalledWith(
    lease,
    "DOCUMENT_PROCESSING_UNAVAILABLE",
  );
  expect(f.storage.readForVerification).not.toHaveBeenCalled();
  expect(f.jobs.publish).not.toHaveBeenCalled();
});
it.each(["versionId", "checksumSha256", "sizeBytes", "mimeType"])(
  "rejects changed committed source %s",
  async (field) => {
    const f = fixture();
    const valid = await f.storage.readForVerification(lease.source, 64);
    f.storage.readForVerification.mockResolvedValue({
      ...valid,
      [field]: field === "sizeBytes" ? 7 : "changed",
    });
    await f.processor.run(lease, new AbortController().signal);
    expect(f.jobs.fail).toHaveBeenCalledWith(lease, "DOCUMENT_SOURCE_MISMATCH");
    expect(f.stages.prepare).not.toHaveBeenCalled();
  },
);
it("normalizes unexpected adapter errors without storing their raw message", async () => {
  const f = fixture();
  f.stages.prepare.mockRejectedValue(
    new Error("secret body and presigned URL"),
  );
  await f.processor.run(lease, new AbortController().signal);
  expect(f.jobs.fail).toHaveBeenCalledWith(
    lease,
    "DOCUMENT_PROCESSING_UNEXPECTED",
  );
});
it("times out noncooperative stages, retains the slot and discards their late output", async () => {
  const f = fixture();
  let release!: () => void;
  f.stages.prepare.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ chunks: [], embeddings: [] });
      }),
  );
  let done = false;
  const running = f.processor
    .run(lease, new AbortController().signal)
    .then(() => {
      done = true;
    });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(f.jobs.fail).toHaveBeenCalledWith(
    lease,
    "DOCUMENT_PROCESSING_TIMEOUT",
  );
  expect(done).toBe(false);
  expect(f.jobs.publish).not.toHaveBeenCalled();
  release();
  await running;
  expect(f.jobs.publish).not.toHaveBeenCalled();
});
it("routes extraction-only results to staging without publishing READY", async () => {
  const f = fixture();
  const extraction = {
    kind: "extracted" as const,
    chunks: [],
    processingVersion: "v1",
    sourceChecksumSha256: lease.source.checksumSha256,
    sourceVersionId: lease.source.versionId,
  };
  f.stages.prepare.mockResolvedValue(extraction);
  await f.processor.run(lease, new AbortController().signal);
  expect(f.jobs.stageExtraction).toHaveBeenCalledWith(lease, extraction);
  expect(f.jobs.publish).not.toHaveBeenCalled();
});

it("uses the remaining job deadline during synchronous chunking after extraction", async () => {
  const f = fixture();
  let elapsed = 0;
  jest.mocked(performance.now).mockImplementation(() => elapsed++);
  const stages = new DocumentExtractionStages(
    {
      extract: async () => {
        elapsed = 18;
        return {
          units: [{ text: "Xin chào Việt Nam!", source: 1 }],
          locatorKind: "LINE",
        };
      },
    },
    { targetTokens: 32, overlapTokens: 0, maxChunks: 10 },
  );
  await new DocumentJobProcessor(f.jobs, f.storage, stages, 64, 20).run(
    lease,
    new AbortController().signal,
  );
  expect(f.jobs.fail).toHaveBeenCalledWith(
    lease,
    "DOCUMENT_PROCESSING_TIMEOUT",
  );
  expect(f.jobs.stageExtraction).not.toHaveBeenCalled();
  expect(f.jobs.publish).not.toHaveBeenCalled();
});
it("rejects synchronous late results even before the abort timer can execute", async () => {
  const f = fixture();
  let elapsed = 0;
  jest.mocked(performance.now).mockImplementation(() => elapsed);
  f.stages.prepare.mockImplementation(async () => {
    elapsed = 21;
    return { chunks: [], embeddings: [] };
  });
  await f.processor.run(lease, new AbortController().signal);
  expect(f.jobs.fail).toHaveBeenCalledWith(
    lease,
    "DOCUMENT_PROCESSING_TIMEOUT",
  );
  expect(f.jobs.publish).not.toHaveBeenCalled();
  expect(f.jobs.stageExtraction).not.toHaveBeenCalled();
});
