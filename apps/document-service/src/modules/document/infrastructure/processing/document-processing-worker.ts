import { randomUUID } from "node:crypto";
import type { OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import type { PinoLogger } from "nestjs-pino";
import type { DocumentProcessingRepository } from "../../application/ports/document-processing.port";
import { DocumentJobProcessor } from "../../application/services/document-job-processor";
export interface DocumentWorkerConfig {
  enabled: boolean;
  concurrency: number;
  pollMs: number;
  shutdownMs: number;
}
export class DocumentProcessingWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly owner = randomUUID();
  private readonly abort = new AbortController();
  private readonly running = new Set<Promise<void>>();
  private timer?: ReturnType<typeof setTimeout>;
  private polling?: Promise<void>;
  constructor(
    private readonly jobs: DocumentProcessingRepository,
    private readonly processor: DocumentJobProcessor,
    private readonly config: DocumentWorkerConfig,
    private readonly logger: PinoLogger,
  ) {}
  onApplicationBootstrap() {
    if (this.config.enabled) this.schedule(0);
  }
  private schedule(delay: number) {
    if (this.abort.signal.aborted) return;
    this.timer = setTimeout(() => {
      this.polling = this.poll().finally(() =>
        this.schedule(this.config.pollMs),
      );
    }, delay);
    this.timer.unref();
  }
  private async poll() {
    try {
      while (
        !this.abort.signal.aborted &&
        this.running.size < this.config.concurrency
      ) {
        const lease = await this.jobs.claim(this.owner);
        if (!lease) break;
        if (this.abort.signal.aborted) break;
        const task = this.processor
          .run(lease, this.abort.signal)
          .catch(() => {
            this.logger.error(
              { jobId: lease.id, code: "DOCUMENT_WORKER_OPERATION_FAILED" },
              "Document job operation failed",
            );
          })
          .finally(() => this.running.delete(task));
        this.running.add(task);
      }
    } catch {
      this.logger.error(
        { code: "DOCUMENT_WORKER_POLL_FAILED" },
        "Document job polling failed",
      );
    }
  }
  async onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
    this.abort.abort();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled([this.polling, ...this.running]),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, this.config.shutdownMs);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
  }
}
