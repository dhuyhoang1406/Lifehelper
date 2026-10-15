export interface SourceObject {
  bucket: string;
  key: string;
}
export interface CleanupLease {
  id: string;
  documentId: string | null;
  owner: string;
  token: number;
  attempt: number;
  object: SourceObject;
  keepVersionId: string | null;
}
export interface DocumentMaintenanceStorage {
  cleanVersions(
    object: SourceObject,
    keepVersionId: string | null,
    signal: AbortSignal,
  ): Promise<boolean>;
  inventory(
    bucket: string,
    cursor: string | null,
    limit: number,
    signal: AbortSignal,
  ): Promise<{
    items: { key: string; modifiedAt: Date }[];
    next: string | null;
  }>;
}
export interface DocumentLifecycleRepository {
  reprocess(
    id: string,
    userId: string,
    key: string,
  ): Promise<{
    documentId: string;
    jobId: string;
    generation: number;
    status: string;
  }>;
  claim(owner: string): Promise<CleanupLease | null>;
  settle(
    lease: CleanupLease,
    outcome: "complete" | "partial" | "failed",
  ): Promise<boolean>;
  reconcile(
    bucket: string,
    items: readonly { key: string; modifiedAt: Date }[],
    cursor: string | null,
    previousCursor?: string | null,
  ): Promise<void>;
  cursor(): Promise<string | null>;
  retain(): Promise<void>;
}
export interface LifecycleLimits {
  leaseMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  resweepMs: number;
  graceMs: number;
  auditDays: number;
  generationDays: number;
  outboxDays: number;
  retentionBatchSize?: number;
  tombstoneDays?: number;
}
export const DOCUMENT_LIFECYCLE_REPOSITORY = Symbol(
  "DOCUMENT_LIFECYCLE_REPOSITORY",
);
export const DOCUMENT_MAINTENANCE_STORAGE = Symbol(
  "DOCUMENT_MAINTENANCE_STORAGE",
);
