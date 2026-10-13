import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma.service";
import { dbNow, lockDocument } from "./document-lock";
import { documentEvent } from "./document-outbox";
import {
  DocumentApplicationError,
  documentNotFound,
} from "../modules/document/application/errors/document.errors";
import { retryEligible } from "../modules/document/domain/processing-policy";
import type {
  CleanupLease,
  DocumentLifecycleRepository,
  LifecycleLimits,
} from "../modules/document/application/ports/document-lifecycle.port";
class LostCleanupLease extends Error {}
export class PrismaDocumentLifecycleRepository implements DocumentLifecycleRepository {
  constructor(
    private readonly db: PrismaService,
    private readonly limits: LifecycleLimits,
  ) {}
  async reprocess(documentId: string, userId: string, key: string) {
    return this.db.$transaction(async (tx) => {
      const d = await lockDocument(tx, documentId, userId);
      if (!d || d.deletedAt) throw documentNotFound();
      const old = await tx.documentProcessingJob.findUnique({
        where: { documentId_reprocessKey: { documentId, reprocessKey: key } },
      });
      if (old)
        return {
          documentId,
          jobId: old.id,
          generation: old.generation,
          status: old.status,
        };
      const pending = await tx.documentProcessingJob.count({
        where: { documentId, status: { in: ["PENDING", "RUNNING"] } },
      });
      if (
        pending ||
        !d.storageVersionId ||
        !d.checksumSha256 ||
        !(
          d.status === "READY" ||
          (d.status === "FAILED" &&
            (retryEligible(d.processingError) ||
              d.processingError === "DOCUMENT_EMBEDDING_MODEL_MISMATCH"))
        )
      )
        throw new DocumentApplicationError(
          "DOCUMENT_REPROCESS_NOT_ELIGIBLE",
          "Document cannot be reprocessed now",
          409,
        );
      const at = await dbNow(tx),
        generation = d.processingGeneration + 1,
        jobId = randomUUID();
      await tx.documentGeneration.create({
        data: { documentId, generation, createdAt: at },
      });
      await tx.documentProcessingJob.create({
        data: {
          id: jobId,
          documentId,
          generation,
          reprocessKey: key,
          nextAttemptAt: at,
          createdAt: at,
          updatedAt: at,
        },
      });
      await documentEvent(
        tx,
        "document.reprocess.requested",
        documentId,
        jobId,
        generation,
        0,
        at,
      );
      return { documentId, jobId, generation, status: "PENDING" };
    });
  }
  async claim(owner: string): Promise<CleanupLease | null> {
    return this.db.$transaction(async (tx) => {
      // All document writers lock the Document before its task. Orphans have no Document.
      const docs = await tx.$queryRaw<
        { id: string }[]
      >`SELECT d.id FROM documents d JOIN document_cleanup_tasks c ON c.document_id=d.id
    WHERE c.next_attempt_at<=clock_timestamp() AND (c.lease_expires_at IS NULL OR c.lease_expires_at<=clock_timestamp())
      AND (c.attempt_count<${this.limits.maxAttempts} OR (c.lease_expires_at<=clock_timestamp() AND c.error_code IS DISTINCT FROM 'DOCUMENT_CLEANUP_RETRY_EXHAUSTED')) ORDER BY c.next_attempt_at,d.id FOR UPDATE OF d SKIP LOCKED LIMIT 1`;
      const d = docs[0]
        ? await tx.document.findUniqueOrThrow({ where: { id: docs[0].id } })
        : null;
      const at = await dbNow(tx);
      const tasks = d
        ? await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM document_cleanup_tasks WHERE document_id=${d.id}::uuid FOR UPDATE SKIP LOCKED`
        : await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM document_cleanup_tasks WHERE document_id IS NULL AND next_attempt_at<=${at}
      AND (lease_expires_at IS NULL OR lease_expires_at<=${at}) AND (attempt_count<${this.limits.maxAttempts} OR (lease_expires_at<=clock_timestamp() AND error_code IS DISTINCT FROM 'DOCUMENT_CLEANUP_RETRY_EXHAUSTED'))
      ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!tasks.length) return null;
      let c = await tx.documentCleanupTask.findUniqueOrThrow({
        where: { id: tasks[0].id },
      });
      if (c.nextAttemptAt > at || (c.leaseExpiresAt && c.leaseExpiresAt > at))
        return null;
      if (c.attemptCount >= this.limits.maxAttempts) {
        await tx.documentCleanupTask.update({
          where: { id: c.id },
          data: {
            leaseOwner: null,
            leaseExpiresAt: null,
            errorCode: "DOCUMENT_CLEANUP_RETRY_EXHAUSTED",
          },
        });
        return null;
      }
      if (
        d?.uploadExpiresAt &&
        d.uploadExpiresAt.getTime() + this.limits.graceMs > at.getTime()
      ) {
        await tx.documentCleanupTask.update({
          where: { id: c.id },
          data: {
            nextAttemptAt: new Date(
              d.uploadExpiresAt.getTime() + this.limits.graceMs,
            ),
          },
        });
        return null;
      }
      if (
        !d &&
        (await tx.document.count({
          where: { s3Bucket: c.bucket!, s3Key: c.key! },
        }))
      ) {
        await tx.documentCleanupTask.delete({ where: { id: c.id } });
        return null;
      }
      let deleted = !!d?.deletedAt;
      if (d?.status === "PENDING_UPLOAD") {
        await tx.document.update({
          where: { id: d.id },
          data: {
            status: "DELETED",
            deletedAt: at,
            activeGeneration: null,
            updatedAt: at,
            revision: { increment: 1 },
          },
        });
        deleted = true;
        await documentEvent(
          tx,
          "document.deleted",
          d.id,
          c.id,
          d.processingGeneration,
          0,
          at,
          "DOCUMENT_UPLOAD_EXPIRED",
        );
      }
      c = await tx.documentCleanupTask.update({
        where: { id: c.id },
        data: {
          leaseOwner: owner,
          leaseToken: { increment: 1 },
          leaseExpiresAt: new Date(at.getTime() + this.limits.leaseMs),
          attemptCount: { increment: 1 },
          errorCode: null,
        },
      });
      return {
        id: c.id,
        documentId: c.documentId,
        owner,
        token: c.leaseToken,
        attempt: c.attemptCount,
        object: { bucket: d?.s3Bucket ?? c.bucket!, key: d?.s3Key ?? c.key! },
        keepVersionId: d && !deleted ? d.storageVersionId : null,
      };
    });
  }
  async settle(
    lease: CleanupLease,
    outcome: "complete" | "partial" | "failed",
  ) {
    try {
      return await this.db.$transaction(async (tx) => {
        const d = lease.documentId
            ? await lockDocument(tx, lease.documentId)
            : null,
          at = await dbNow(tx);
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM document_cleanup_tasks WHERE id=${lease.id}::uuid FOR UPDATE`;
        if (!rows.length) return false;
        const c = await tx.documentCleanupTask.findUniqueOrThrow({
          where: { id: lease.id },
        });
        if (
          c.leaseOwner !== lease.owner ||
          c.leaseToken !== lease.token ||
          !c.leaseExpiresAt ||
          c.leaseExpiresAt <= at
        )
          return false;
        const complete = outcome === "complete",
          failed = outcome === "failed";
        if (complete && d?.deletedAt) {
          await tx.documentGeneration.deleteMany({
            where: { documentId: d.id },
          });
          if (!c.completedAt)
            await documentEvent(
              tx,
              "document.cleanup.completed",
              d.id,
              c.id,
              d.processingGeneration,
              c.attemptCount,
              at,
            );
        }
        const exhausted = failed && c.attemptCount >= this.limits.maxAttempts;
        const delay = failed
          ? Math.min(
              this.limits.retryMaxMs,
              this.limits.retryBaseMs * 2 ** Math.min(c.attemptCount - 1, 20),
            ) *
            (0.5 + Math.random() / 2)
          : complete
            ? this.limits.resweepMs
            : 0;
        await tx.documentCleanupTask.update({
          where: { id: c.id },
          data: {
            leaseOwner: null,
            leaseExpiresAt: null,
            nextAttemptAt: new Date(at.getTime() + Math.floor(delay)),
            attemptCount: failed ? c.attemptCount : 0,
            completedAt: complete ? at : c.completedAt,
            errorCode: exhausted
              ? "DOCUMENT_CLEANUP_RETRY_EXHAUSTED"
              : failed
                ? "DOCUMENT_CLEANUP_UNAVAILABLE"
                : outcome === "partial"
                  ? "DOCUMENT_CLEANUP_PARTIAL"
                  : null,
          },
        });
        if (c.leaseExpiresAt <= (await dbNow(tx))) throw new LostCleanupLease();
        return true;
      });
    } catch (error) {
      if (error instanceof LostCleanupLease) return false;
      throw error;
    }
  }
  async cursor() {
    return (
      (
        await this.db.documentMaintenanceCursor.findUnique({
          where: { name: "source-inventory" },
        })
      )?.cursor ?? null
    );
  }
  async reconcile(
    bucket: string,
    items: readonly { key: string; modifiedAt: Date }[],
    cursor: string | null,
    previousCursor: string | null = null,
  ) {
    await this.db.$transaction(async (tx) => {
      const at = await dbNow(tx);
      const newest = new Map<string, { key: string; modifiedAt: Date }>();
      for (const item of items)
        if (
          !newest.has(item.key) ||
          newest.get(item.key)!.modifiedAt < item.modifiedAt
        )
          newest.set(item.key, item);
      for (const item of newest.values()) {
        if (
          !/^users\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(txt|md|pdf)$/.test(
            item.key,
          ) ||
          !Number.isFinite(item.modifiedAt.getTime()) ||
          item.modifiedAt.getTime() > at.getTime() - this.limits.graceMs
        )
          continue;
        if (
          await tx.document.count({
            where: { s3Bucket: bucket, s3Key: item.key },
          })
        )
          continue;
        const target = await tx.documentCleanupTask.upsert({
          where: { bucket_key: { bucket, key: item.key } },
          create: { bucket, key: item.key, nextAttemptAt: at, createdAt: at },
          update: {},
        });
        // Seeing bytes after a successful orphan sweep schedules a fresh pass without bypassing failed-task backoff.
        await tx.documentCleanupTask.updateMany({
          where: {
            id: target.id,
            completedAt: { not: null },
            leaseOwner: null,
            errorCode: null,
          },
          data: { nextAttemptAt: at },
        });
      }
      await tx.documentMaintenanceCursor.upsert({
        where: { name: "source-inventory" },
        create: { name: "source-inventory", cursor: null, updatedAt: at },
        update: {},
      });
      await tx.documentMaintenanceCursor.updateMany({
        where: { name: "source-inventory", cursor: previousCursor },
        data: { cursor, updatedAt: at },
      });
    });
  }
  async retain() {
    const retentionBatch = this.limits.retentionBatchSize ?? 100;
    const now = Date.now(),
      auditBefore = new Date(now - this.limits.auditDays * 86400000),
      generationBefore = new Date(now - this.limits.generationDays * 86400000),
      outboxBefore = new Date(now - this.limits.outboxDays * 86400000);
    // Bounded batches. Active/current running generations are never retention targets.
    const old = await this.db.$queryRaw<
      { documentId: string; generation: number }[]
    >`SELECT g.document_id AS "documentId",g.generation FROM document_generations g
   JOIN documents d ON d.id=g.document_id WHERE g.created_at<${generationBefore} AND g.generation IS DISTINCT FROM d.active_generation
    AND g.status IN ('COMPLETE','FAILED') AND EXISTS (SELECT 1 FROM document_chunks c WHERE c.document_id=g.document_id AND c.generation=g.generation) AND NOT EXISTS(SELECT 1 FROM document_processing_jobs j WHERE j.document_id=g.document_id AND j.generation=g.generation AND j.status IN ('RUNNING','PENDING')) LIMIT ${retentionBatch}`;
    for (const g of old)
      await this.db.$transaction(async (tx) => {
        const d = await lockDocument(tx, g.documentId);
        if (!d || d.activeGeneration === g.generation) return;
        const eligible = await tx.documentGeneration.findFirst({
          where: {
            documentId: g.documentId,
            generation: g.generation,
            status: { in: ["COMPLETE", "FAILED"] },
            createdAt: { lt: generationBefore },
            OR: [
              { job: { is: null } },
              { job: { is: { status: { notIn: ["RUNNING", "PENDING"] } } } },
            ],
          },
        });
        if (eligible)
          await tx.documentChunk.deleteMany({
            where: { documentId: g.documentId, generation: g.generation },
          });
      });
    const tombstoneBefore = new Date(
      now - (this.limits.tombstoneDays ?? 30) * 86400000,
    );
    const tombstones = await this.db.document.findMany({
      where: {
        deletedAt: { lt: tombstoneBefore },
        cleanup: {
          is: {
            completedAt: { not: null },
            leaseOwner: null,
            errorCode: null,
            nextAttemptAt: { gt: new Date(now) },
          },
        },
      },
      select: { id: true },
      take: retentionBatch,
    });
    for (const candidate of tombstones)
      await this.db.$transaction(async (tx) => {
        const d = await lockDocument(tx, candidate.id);
        if (!d?.deletedAt || d.deletedAt >= tombstoneBefore) return;
        const task = await tx.documentCleanupTask.findUnique({
          where: { documentId: d.id },
        });
        if (
          task?.completedAt &&
          !task.leaseOwner &&
          !task.errorCode &&
          task.nextAttemptAt > (await dbNow(tx))
        )
          await tx.document.delete({ where: { id: d.id } });
      });
    await this.db
      .$executeRaw`UPDATE document_processing_audits SET status='EXPIRED',finished_at=clock_timestamp(),error_code='DOCUMENT_WORKER_LEASE_EXPIRED'
      WHERE status='RUNNING' AND id IN (SELECT a.id FROM document_processing_audits a WHERE a.started_at<${auditBefore} AND a.status='RUNNING'
        AND NOT EXISTS (SELECT 1 FROM document_processing_jobs j WHERE j.id=a.job_id AND j.lease_token=a.lease_token AND j.status='RUNNING' AND j.lease_expires_at>clock_timestamp()) LIMIT ${retentionBatch})`;
    await this.db
      .$executeRaw`DELETE FROM document_processing_audits WHERE id IN (SELECT id FROM document_processing_audits WHERE started_at<${auditBefore} AND status<>'RUNNING' LIMIT ${retentionBatch})`;
    await this.db
      .$executeRaw`DELETE FROM document_cleanup_tasks WHERE id IN (SELECT id FROM document_cleanup_tasks WHERE document_id IS NULL AND completed_at IS NOT NULL AND lease_owner IS NULL AND error_code IS NULL AND next_attempt_at>clock_timestamp() AND created_at<${auditBefore} LIMIT ${retentionBatch} FOR UPDATE SKIP LOCKED)`;
    await this.db
      .$executeRaw`DELETE FROM outbox_events WHERE processed_at<${outboxBefore} AND id IN (SELECT id FROM outbox_events WHERE processed_at<${outboxBefore} LIMIT ${retentionBatch} FOR UPDATE SKIP LOCKED)`;
  }
}
