import { performance } from "node:perf_hooks";
import type {
  DocumentProcessingRepository,
  DocumentProcessingStages,
  ProcessingLease,
} from "../ports/document-processing.port";
import type { DocumentStorage } from "../ports/document-storage.port";
import {
  DocumentProcessingFailure,
  processingFailure,
} from "../../domain/processing-policy";
export class DocumentJobProcessor {
  constructor(
    private readonly jobs: DocumentProcessingRepository,
    private readonly storage: DocumentStorage,
    private readonly stages: DocumentProcessingStages,
    private readonly maxFileBytes: number,
    private readonly timeoutMs: number,
  ) {}
  async run(
    lease: ProcessingLease,
    shutdownSignal: AbortSignal,
  ): Promise<void> {
    const deadline = performance.now() + this.timeoutMs;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, shutdownSignal]);
    const checkpoint = () => {
      if (signal.aborted || performance.now() >= deadline)
        throw new DocumentProcessingFailure("DOCUMENT_PROCESSING_TIMEOUT");
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    const processing = (async () => {
      if (!this.stages.available)
        throw new DocumentProcessingFailure("DOCUMENT_PROCESSING_UNAVAILABLE");
      if (this.stages.index) {
        const extraction = await this.jobs.loadExtraction(lease);
        checkpoint();
        if (extraction)
          return this.stages.index(lease, extraction, signal, checkpoint);
      }
      const source = await this.storage.readForVerification(
        lease.source,
        this.maxFileBytes,
        lease.source.versionId,
        signal,
      );
      if (
        source.versionId !== lease.source.versionId ||
        source.checksumSha256 !== lease.source.checksumSha256 ||
        BigInt(source.sizeBytes) !== lease.source.sizeBytes ||
        source.mimeType !== lease.source.mimeType
      )
        throw new DocumentProcessingFailure("DOCUMENT_SOURCE_MISMATCH");
      checkpoint();
      const result = await this.stages.prepare(
        lease,
        source.bytes,
        signal,
        checkpoint,
      );
      checkpoint();
      return result;
    })();
    const aborted = new Promise<never>((_, reject) => {
      abortListener = () =>
        reject(new DocumentProcessingFailure("DOCUMENT_PROCESSING_TIMEOUT"));
      signal.addEventListener("abort", abortListener, { once: true });
      if (signal.aborted) abortListener();
      timer = setTimeout(() => controller.abort(), this.timeoutMs);
    });
    try {
      const result = await Promise.race([processing, aborted]);
      checkpoint();
      if ("kind" in result) {
        if (this.stages.index)
          await this.jobs.stageExtraction(lease, result, true);
        else await this.jobs.stageExtraction(lease, result);
      } else await this.jobs.publish(lease, result);
    } catch (error) {
      await this.jobs.fail(
        lease,
        signal.aborted
          ? "DOCUMENT_PROCESSING_TIMEOUT"
          : processingFailure(error),
      );
    } finally {
      if (timer) clearTimeout(timer);
      if (abortListener) signal.removeEventListener("abort", abortListener);
      // An adapter ignoring abort must keep occupying this process's bounded slot.
      // Its late result is discarded; another replica can recover the fenced lease.
      await processing.catch(() => undefined);
    }
  }
}
