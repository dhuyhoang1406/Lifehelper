import { randomUUID } from "node:crypto";
import type {
  DocumentLifecycleRepository,
  DocumentMaintenanceStorage,
} from "../ports/document-lifecycle.port";
export class DocumentLifecycleMaintenance {
  private readonly owner = randomUUID();
  constructor(
    private readonly repository: DocumentLifecycleRepository,
    private readonly storage: DocumentMaintenanceStorage,
    private readonly config: {
      bucket: string;
      inventoryLimit: number;
      batchSize: number;
      timeoutMs: number;
    },
  ) {}
  async tick(signal: AbortSignal) {
    let inventoryFailed = false;
    try {
      const cursor = await this.repository.cursor();
      const page = await this.storage.inventory(
        this.config.bucket,
        cursor,
        this.config.inventoryLimit,
        AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)]),
      );
      await this.repository.reconcile(
        this.config.bucket,
        page.items,
        page.next,
        cursor,
      );
    } catch {
      if (signal.aborted) return;
      inventoryFailed = true;
    }
    for (let i = 0; i < this.config.batchSize && !signal.aborted; i++) {
      const lease = await this.repository.claim(this.owner);
      if (!lease) break;
      let outcome: "complete" | "partial" | "failed";
      try {
        outcome = (await this.storage.cleanVersions(
          lease.object,
          lease.keepVersionId,
          AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)]),
        ))
          ? "complete"
          : "partial";
      } catch {
        outcome = "failed";
      }
      await this.repository.settle(lease, outcome);
    }
    await this.repository.retain();
    if (inventoryFailed) throw new Error("Document inventory unavailable");
  }
}
