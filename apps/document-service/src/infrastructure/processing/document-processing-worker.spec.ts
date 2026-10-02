import type { PinoLogger } from "nestjs-pino";
import type {
  DocumentProcessingRepository,
  ProcessingLease,
} from "../../application/ports/document-processing.port";
import { DocumentJobProcessor } from "../../application/services/document-job-processor";
import { DocumentProcessingWorker } from "./document-processing-worker";
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
it("bounds active jobs including noncooperative stages and bounds shutdown", async () => {
  const jobs: jest.Mocked<DocumentProcessingRepository> = {
    claim: jest.fn().mockResolvedValue({ id: "job" } as ProcessingLease),
    publish: jest.fn(),
    fail: jest.fn(),
    retry: jest.fn(),
  };
  const run = jest
    .fn()
    .mockImplementation(() => new Promise<void>(() => undefined));
  const processor = { run } as unknown as DocumentJobProcessor;
  const logger = { error: jest.fn() } as unknown as PinoLogger;
  const worker = new DocumentProcessingWorker(
    jobs,
    processor,
    { enabled: true, concurrency: 2, pollMs: 50, shutdownMs: 100 },
    logger,
  );
  worker.onApplicationBootstrap();
  await jest.advanceTimersByTimeAsync(250);
  expect(jobs.claim).toHaveBeenCalledTimes(2);
  expect(run).toHaveBeenCalledTimes(2);
  const closing = worker.onModuleDestroy();
  await jest.advanceTimersByTimeAsync(100);
  await closing;
  expect((run.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
  await jest.advanceTimersByTimeAsync(500);
  expect(jobs.claim).toHaveBeenCalledTimes(2);
});
it("does not poll when worker is disabled", async () => {
  const claim = jest.fn();
  const worker = new DocumentProcessingWorker(
    { claim } as unknown as DocumentProcessingRepository,
    {} as DocumentJobProcessor,
    { enabled: false, concurrency: 2, pollMs: 50, shutdownMs: 100 },
    {} as PinoLogger,
  );
  worker.onApplicationBootstrap();
  await jest.advanceTimersByTimeAsync(100);
  expect(claim).not.toHaveBeenCalled();
  await worker.onModuleDestroy();
});
