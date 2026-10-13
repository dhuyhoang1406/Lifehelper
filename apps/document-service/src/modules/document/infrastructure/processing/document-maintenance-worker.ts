import type { OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import type { PinoLogger } from "nestjs-pino";
import { DocumentLifecycleMaintenance } from "../../application/services/document-lifecycle-maintenance";
export class DocumentMaintenanceWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private readonly abort = new AbortController();
  constructor(
    private readonly maintenance: DocumentLifecycleMaintenance,
    private readonly config: {
      enabled: boolean;
      pollMs: number;
      shutdownMs: number;
    },
    private readonly logger: PinoLogger,
  ) {}
  onApplicationBootstrap() {
    if (this.config.enabled) this.schedule(0);
  }
  private schedule(delay: number) {
    if (this.abort.signal.aborted) return;
    this.timer = setTimeout(() => {
      this.running = this.maintenance
        .tick(this.abort.signal)
        .catch(() =>
          this.logger.error(
            { code: "DOCUMENT_MAINTENANCE_OPERATION_FAILED" },
            "Document maintenance failed",
          ),
        )
        .finally(() => this.schedule(this.config.pollMs));
    }, delay);
    this.timer.unref();
  }
  async onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
    this.abort.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.running,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.config.shutdownMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
  }
}
