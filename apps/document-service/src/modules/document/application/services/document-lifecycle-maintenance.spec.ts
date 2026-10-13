import { DocumentLifecycleMaintenance } from "./document-lifecycle-maintenance";
import { DocumentReprocessUseCase } from "../use-cases/document-reprocess.use-case";
import type {
  DocumentLifecycleRepository,
  DocumentMaintenanceStorage,
  CleanupLease,
} from "../ports/document-lifecycle.port";
const lease: CleanupLease = {
  id: "cleanup",
  documentId: "doc",
  owner: "worker",
  token: 1,
  attempt: 1,
  object: { bucket: "private", key: "source" },
  keepVersionId: "committed",
};
describe("Bounded lifecycle maintenance", () => {
  let repo: jest.Mocked<DocumentLifecycleRepository>,
    storage: jest.Mocked<DocumentMaintenanceStorage>;
  beforeEach(() => {
    repo = {
      reprocess: jest.fn(),
      claim: jest.fn().mockResolvedValue(lease),
      settle: jest.fn().mockResolvedValue(true),
      reconcile: jest.fn(),
      cursor: jest.fn().mockResolvedValue(null),
      retain: jest.fn(),
    };
    storage = {
      inventory: jest.fn().mockResolvedValue({ items: [], next: null }),
      cleanVersions: jest.fn().mockResolvedValue(true),
    };
  });
  const run = () =>
    new DocumentLifecycleMaintenance(repo, storage, {
      bucket: "private",
      inventoryLimit: 100,
      batchSize: 2,
      timeoutMs: 100,
    }).tick(new AbortController().signal);
  it("bounds each poll and preserves the committed version during maintenance", async () => {
    await run();
    expect(repo.claim).toHaveBeenCalledTimes(2);
    expect(storage.cleanVersions).toHaveBeenCalledWith(
      lease.object,
      "committed",
      expect.any(AbortSignal),
    );
    expect(repo.settle).toHaveBeenCalledWith(lease, "complete");
    expect(repo.retain).toHaveBeenCalled();
  });
  it("persists safe failure outcomes instead of upstream messages", async () => {
    storage.cleanVersions.mockRejectedValue(new Error("secret signed URL"));
    await run();
    expect(repo.settle).toHaveBeenCalledWith(lease, "failed");
  });
  it("requeues partial version deletion without claiming cleanup completed", async () => {
    storage.cleanVersions.mockResolvedValue(false);
    await run();
    expect(repo.settle).toHaveBeenCalledWith(lease, "partial");
  });
  it("continues durable cleanup and retention when inventory fails", async () => {
    storage.inventory.mockRejectedValue(new Error("unavailable"));
    await expect(run()).rejects.toThrow("Document inventory unavailable");
    expect(repo.claim).toHaveBeenCalled();
    expect(repo.retain).toHaveBeenCalled();
  });
  it("validates idempotency keys before calling persistence", async () => {
    const useCase = new DocumentReprocessUseCase(repo);
    expect(() => useCase.execute("doc", "owner", undefined)).toThrow();
    expect(() => useCase.execute("doc", "owner", "bad")).toThrow();
    expect(repo.reprocess).not.toHaveBeenCalled();
    await useCase.execute(
      "doc",
      "owner",
      "00000000-0000-4000-8000-0000000000AA",
    );
    expect(repo.reprocess).toHaveBeenCalledWith(
      "doc",
      "owner",
      "00000000-0000-4000-8000-0000000000aa",
    );
  });
});
