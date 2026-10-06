import { randomUUID } from "node:crypto";
import { PrismaService } from "../src/prisma.service";
import { PrismaDocumentUploadRepository } from "../src/persistence/document-upload.repository";
import { PrismaDocumentProcessingRepository } from "../src/persistence/document-processing.repository";
import { Document } from "../src/modules/document/domain/entities/document.entity";
import { DocumentChunk } from "../src/modules/document/domain/entities/document-chunk.entity";
import { DocumentEmbedding } from "../src/modules/document/domain/entities/document-embedding.entity";
import {
  PrismaDocumentRepository,
  PrismaDocumentChunkRepository,
} from "../src/persistence/document.persistence";
import type { ProcessingLease } from "../src/modules/document/application/ports/document-processing.port";
const db = new PrismaService();
const userId = randomUUID();
const ids: string[] = [];
const limits = {
  leaseMs: 60000,
  maxAttempts: 3,
  baseDelayMs: 10,
  maxDelayMs: 100,
  maxChunks: 10,
  maxTextChars: 1000,
  maxVectorValues: 100,
};
const jobs = new PrismaDocumentProcessingRepository(db, limits, () => 0);
const uploads = new PrismaDocumentUploadRepository(db);
async function reserve() {
  const id = randomUUID();
  ids.push(id);
  const d = Document.create({
    id,
    userId,
    originalFilename: "notes.txt",
    storageFilename: "notes.txt",
    mimeType: "text/plain",
    sizeBytes: 6n,
    s3Bucket: "test-private",
    s3Key: `fixtures/${id}`,
    uploadExpiresAt: new Date(Date.now() + 600000),
  });
  await uploads.reserve(d, 100, 100000n);
  return id;
}
async function uploaded() {
  const id = await reserve();
  expect(
    await uploads.commitUpload(
      id,
      userId,
      0,
      "committed-version",
      "a".repeat(64),
      new Date(),
    ),
  ).toBe(true);
  return id;
}
async function claimed() {
  const id = await uploaded();
  const lease = await jobs.claim("worker-a");
  expect(lease?.documentId).toBe(id);
  return lease!;
}
function prepared(lease: ProcessingLease) {
  const chunk = DocumentChunk.create({
    id: randomUUID(),
    documentId: lease.documentId,
    generation: lease.generation,
    chunkIndex: 0,
    content: "hello!",
    tokenCount: 2,
    locator: { kind: "LINE", start: 1, end: 1 },
  });
  const embedding = DocumentEmbedding.create({
    id: randomUUID(),
    chunkId: chunk.state.id,
    embeddingModel: "test-fixture",
    modelVersion: "test-v1",
    embedding: [0.1, 0.2],
  });
  return { chunks: [chunk], embeddings: [embedding] };
}
async function due(id: string) {
  await db.documentProcessingJob.update({
    where: { id },
    data: { nextAttemptAt: new Date(0) },
  });
}
async function fault(
  eventType: string,
  id: string,
  action: () => Promise<void>,
) {
  await db.$executeRawUnsafe(`CREATE FUNCTION test_document_outbox_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.aggregate_id='${id}'::uuid AND NEW.event_type='${eventType}' THEN RAISE EXCEPTION 'Synthetic outbox failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe(
    "CREATE TRIGGER test_document_outbox_failure BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION test_document_outbox_failure()",
  );
  try {
    await action();
  } finally {
    await db.$executeRawUnsafe(
      "DROP TRIGGER test_document_outbox_failure ON outbox_events",
    );
    await db.$executeRawUnsafe("DROP FUNCTION test_document_outbox_failure()");
  }
}
describe("Durable fenced processing on real PostgreSQL", () => {
  beforeAll(async () => {
    const rows = await db.$queryRaw<
      Array<{ name: string }>
    >`SELECT current_database() AS name`;
    if (!/_test$|_ci$/.test(rows[0]?.name ?? ""))
      throw new Error("Dedicated test database required");
  });
  afterEach(async () => {
    await db.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } });
    await db.document.deleteMany({ where: { userId } });
    ids.length = 0;
  });
  afterAll(() => db.$disconnect());
  it("atomically schedules one generation/job/event under duplicate completion", async () => {
    const id = await reserve();
    const results = await Promise.all(
      [0, 1].map(() =>
        uploads.commitUpload(
          id,
          userId,
          0,
          "version",
          "a".repeat(64),
          new Date(),
        ),
      ),
    );
    expect(results.sort()).toEqual([false, true]);
    expect(
      await db.documentProcessingJob.count({ where: { documentId: id } }),
    ).toBe(1);
    expect(
      await db.documentGeneration.count({ where: { documentId: id } }),
    ).toBe(1);
    const event = await db.outboxEvent.findFirstOrThrow({
      where: { aggregateId: id },
    });
    expect(event.eventType).toBe("document.uploaded");
    expect(event.payload).toMatchObject({
      id: event.id,
      occurredAt: event.occurredAt.toISOString(),
      version: 1,
    });
    expect(JSON.stringify(event.payload)).not.toMatch(
      /fixtures|checksum|notes|versionId|secret|hello/,
    );
    expect(
      (await db.document.findUniqueOrThrow({ where: { id } })).status,
    ).toBe("UPLOADED");
  });
  it("competing workers claim once and commit PROCESSING with its event", async () => {
    const id = await uploaded();
    const claims = await Promise.all([jobs.claim("a"), jobs.claim("b")]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const lease = claims.find(Boolean)!;
    expect(lease.token).toBe(1);
    expect(lease.attemptCount).toBe(1);
    expect(
      (await db.document.findUniqueOrThrow({ where: { id } })).status,
    ).toBe("PROCESSING");
    expect(
      await db.outboxEvent.count({
        where: { aggregateId: id, eventType: "document.processing.started" },
      }),
    ).toBe(1);
  });
  it("recovers a crashed worker across repository restart and fences stale results", async () => {
    const old = await claimed();
    await db.documentProcessingJob.update({
      where: { id: old.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    const restarted = new PrismaDocumentProcessingRepository(
      db,
      limits,
      () => 0,
    );
    expect(await restarted.claim("restarted")).toBeNull();
    expect(await jobs.publish(old, prepared(old))).toBe(false);
    expect(await jobs.fail(old, "DOCUMENT_STORAGE_TIMEOUT")).toBe(false);
    await due(old.id);
    const current = (await restarted.claim("restarted"))!;
    expect(current.token).toBe(old.token + 1);
    expect(current.attemptCount).toBe(2);
    expect(current.generation).toBe(old.generation);
    expect(await jobs.publish(old, prepared(old))).toBe(false);
    expect(await restarted.publish(current, prepared(current))).toBe(true);
    const d = await db.document.findUniqueOrThrow({
      where: { id: old.documentId },
    });
    expect(d.status).toBe("READY");
    expect(d.activeGeneration).toBe(1);
    expect(await db.documentChunk.count({ where: { documentId: d.id } })).toBe(
      1,
    );
    expect(await restarted.publish(current, prepared(current))).toBe(false);
  });
  it("rejects expired current leases even before another worker recovers", async () => {
    const lease = await claimed();
    await db.documentProcessingJob.update({
      where: { id: lease.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    expect(await jobs.publish(lease, prepared(lease))).toBe(false);
    expect(await jobs.fail(lease, "DOCUMENT_STORAGE_TIMEOUT")).toBe(false);
    expect(
      await db.documentChunk.count({ where: { documentId: lease.documentId } }),
    ).toBe(0);
  });
  it("bounds transient retries, then fails once with sanitized outbox", async () => {
    let lease = await claimed();
    for (let attempt = 1; attempt <= 3; attempt++) {
      expect(await jobs.fail(lease, "DOCUMENT_STORAGE_TIMEOUT")).toBe(true);
      const j = await db.documentProcessingJob.findUniqueOrThrow({
        where: { id: lease.id },
      });
      expect(j.attemptCount).toBe(attempt);
      if (attempt < 3) {
        expect(j.status).toBe("PENDING");
        expect(j.nextAttemptAt.getTime() - j.updatedAt.getTime()).toBe(
          5 * 2 ** (attempt - 1),
        );
        await due(j.id);
        lease = (await jobs.claim("worker-retry"))!;
      } else expect(j.status).toBe("FAILED");
    }
    expect(
      (await db.document.findUniqueOrThrow({ where: { id: lease.documentId } }))
        .processingError,
    ).toBe("DOCUMENT_STORAGE_TIMEOUT");
    expect(await jobs.claim("idle")).toBeNull();
    expect(await jobs.fail(lease, "DOCUMENT_STORAGE_TIMEOUT")).toBe(false);
    expect(
      await db.outboxEvent.count({
        where: {
          aggregateId: lease.documentId,
          eventType: "document.processing.failed",
        },
      }),
    ).toBe(1);
  });
  it("exhausts repeated crashes rather than reclaiming forever", async () => {
    let lease = await claimed();
    for (let attempt = 1; attempt <= 3; attempt++) {
      await db.documentProcessingJob.update({
        where: { id: lease.id },
        data: { leaseExpiresAt: new Date(0) },
      });
      expect(await jobs.claim("recover")).toBeNull();
      if (attempt < 3) {
        await due(lease.id);
        lease = (await jobs.claim("recover"))!;
      }
    }
    expect(
      (
        await db.documentProcessingJob.findUniqueOrThrow({
          where: { id: lease.id },
        })
      ).status,
    ).toBe("FAILED");
    expect(
      (await db.document.findUniqueOrThrow({ where: { id: lease.documentId } }))
        .processingError,
    ).toBe("DOCUMENT_WORKER_LEASE_EXPIRED");
  });
  it("permanent unsupported input fails immediately and cannot be manually retried", async () => {
    const lease = await claimed();
    await jobs.fail(lease, "DOCUMENT_UNSUPPORTED_INPUT");
    expect(
      (
        await db.documentProcessingJob.findUniqueOrThrow({
          where: { id: lease.id },
        })
      ).attemptCount,
    ).toBe(1);
    await expect(jobs.retry(lease.documentId, userId)).rejects.toMatchObject({
      code: "DOCUMENT_RETRY_NOT_ELIGIBLE",
    });
  });
  it("owner retry is idempotent and creates a new generation", async () => {
    const old = await claimed();
    await jobs.fail(old, "DOCUMENT_PROCESSING_UNAVAILABLE");
    await expect(
      jobs.retry(old.documentId, randomUUID()),
    ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    const queued = await Promise.all([
      jobs.retry(old.documentId, userId),
      jobs.retry(old.documentId, userId),
    ]);
    expect(queued[0]).toEqual(queued[1]);
    expect(queued[0].generation).toBe(2);
    const current = (await jobs.claim("new-worker"))!;
    expect(current.generation).toBe(2);
    expect(current.attemptCount).toBe(1);
    expect(await jobs.publish(old, prepared(old))).toBe(false);
    expect(await jobs.publish(current, prepared(current))).toBe(true);
  });
  it("cannot resurrect a document deleted concurrently with publication", async () => {
    const lease = await claimed();
    const [published, deleted] = await Promise.all([
      jobs.publish(lease, prepared(lease)),
      uploads.deleteAndScheduleCleanup(lease.documentId, userId, new Date()),
    ]);
    expect(typeof published).toBe("boolean");
    expect(deleted).toBe(true);
    const d = await db.document.findUniqueOrThrow({
      where: { id: lease.documentId },
    });
    expect(d.status).toBe("DELETED");
    expect(d.activeGeneration).toBeNull();
    expect(await jobs.publish(lease, prepared(lease))).toBe(false);
    await expect(jobs.retry(d.id, userId)).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND",
    });
  });
  it("rejects no-op results without creating a READY generation", async () => {
    const lease = await claimed();
    await expect(
      jobs.publish(lease, { chunks: [], embeddings: [] }),
    ).rejects.toMatchObject({ code: "DOCUMENT_PROCESSING_RESULT_INVALID" });
    expect(
      (await db.document.findUniqueOrThrow({ where: { id: lease.documentId } }))
        .status,
    ).toBe("PROCESSING");
  });
  it("guards publication with both lease owner and fencing token", async () => {
    const lease = await claimed();
    for (const forged of [
      { ...lease, owner: "wrong-worker" },
      { ...lease, token: lease.token + 1 },
    ]) {
      expect(await jobs.publish(forged, prepared(forged))).toBe(false);
      expect(await jobs.fail(forged, "DOCUMENT_STORAGE_TIMEOUT")).toBe(false);
    }
    expect(
      await db.documentChunk.count({ where: { documentId: lease.documentId } }),
    ).toBe(0);
  });
  it("blocks legacy unfenced writers for verified source documents", async () => {
    const lease = await claimed();
    const result = prepared(lease);
    await expect(
      new PrismaDocumentChunkRepository(db).insert(result.chunks[0], userId),
    ).rejects.toThrow();
    const d = await db.document.findUniqueOrThrow({
      where: { id: lease.documentId },
    });
    expect(
      await new PrismaDocumentRepository(db).activateGeneration(
        d.id,
        userId,
        lease.generation,
        d.revision,
        new Date(),
      ),
    ).toBe(false);
    expect(await jobs.publish(lease, result)).toBe(true);
  });
  it("fails legacy jobs without verified source identity instead of leaving PROCESSING forever", async () => {
    const id = await reserve();
    const legacyRepo = new PrismaDocumentRepository(db);
    const document = (await legacyRepo.findByIdAndUserId(id, userId))!;
    document.markUploaded();
    expect(await legacyRepo.save(document, 0)).toBe(true);
    expect(
      await legacyRepo.startGeneration(id, userId, 1, randomUUID(), new Date()),
    ).toBe(1);
    expect(await jobs.claim("source-guard")).toBeNull();
    const persisted = await db.document.findUniqueOrThrow({ where: { id } });
    expect(persisted.status).toBe("FAILED");
    expect(persisted.processingError).toBe("DOCUMENT_SOURCE_MISMATCH");
  });
  it("rolls back prepared output if the lease expires during final publication", async () => {
    const lease = await claimed();
    await db.$executeRawUnsafe(`CREATE FUNCTION test_delay_document_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.aggregate_id='${lease.documentId}'::uuid AND NEW.event_type='document.processing.ready'
      THEN PERFORM pg_sleep(0.2); END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(
      "CREATE TRIGGER test_delay_document_event BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION test_delay_document_event()",
    );
    try {
      await db.$executeRaw`UPDATE document_processing_jobs SET lease_expires_at=clock_timestamp()+interval '100 milliseconds' WHERE id=${lease.id}::uuid`;
      expect(await jobs.publish(lease, prepared(lease))).toBe(false);
      expect(
        await db.documentChunk.count({
          where: { documentId: lease.documentId },
        }),
      ).toBe(0);
      expect(
        (
          await db.document.findUniqueOrThrow({
            where: { id: lease.documentId },
          })
        ).status,
      ).toBe("PROCESSING");
      expect(
        await db.outboxEvent.count({
          where: {
            aggregateId: lease.documentId,
            eventType: "document.processing.ready",
          },
        }),
      ).toBe(0);
    } finally {
      await db.$executeRawUnsafe(
        "DROP TRIGGER test_delay_document_event ON outbox_events",
      );
      await db.$executeRawUnsafe("DROP FUNCTION test_delay_document_event()");
    }
  });
  it("serializes manual retry against deletion without leaving active jobs", async () => {
    const lease = await claimed();
    await jobs.fail(lease, "DOCUMENT_PROCESSING_UNAVAILABLE");
    await Promise.allSettled([
      jobs.retry(lease.documentId, userId),
      uploads.deleteAndScheduleCleanup(lease.documentId, userId, new Date()),
    ]);
    expect(
      (await db.document.findUniqueOrThrow({ where: { id: lease.documentId } }))
        .status,
    ).toBe("DELETED");
    expect(
      await db.documentProcessingJob.count({
        where: {
          documentId: lease.documentId,
          status: { in: ["PENDING", "RUNNING"] },
        },
      }),
    ).toBe(0);
  });
  it.each([
    "document.uploaded",
    "document.processing.started",
    "document.processing.failed",
    "document.processing.ready",
  ])(
    "rolls back lifecycle changes when %s outbox write fails",
    async (event) => {
      const id =
        event === "document.uploaded" ? await reserve() : await uploaded();
      const lease =
        event === "document.processing.failed" ||
        event === "document.processing.ready"
          ? (await jobs.claim("a"))!
          : null;
      const before = await db.document.findUniqueOrThrow({ where: { id } });
      await fault(event, id, async () => {
        if (event === "document.uploaded")
          await expect(
            uploads.commitUpload(
              id,
              userId,
              0,
              "v",
              "a".repeat(64),
              new Date(),
            ),
          ).rejects.toThrow();
        if (event === "document.processing.started")
          await expect(jobs.claim("a")).rejects.toThrow();
        if (event === "document.processing.failed")
          await expect(
            jobs.fail(lease!, "DOCUMENT_UNSUPPORTED_INPUT"),
          ).rejects.toThrow();
        if (event === "document.processing.ready")
          await expect(
            jobs.publish(lease!, prepared(lease!)),
          ).rejects.toThrow();
      });
      expect(await db.document.findUniqueOrThrow({ where: { id } })).toEqual(
        before,
      );
      expect(
        await db.outboxEvent.count({
          where: { aggregateId: id, eventType: event },
        }),
      ).toBe(0);
      expect(await db.documentChunk.count({ where: { documentId: id } })).toBe(
        0,
      );
      if (event === "document.uploaded")
        expect(
          await db.documentProcessingJob.count({ where: { documentId: id } }),
        ).toBe(0);
      if (event === "document.processing.started")
        expect(
          (
            await db.documentProcessingJob.findFirstOrThrow({
              where: { documentId: id },
            })
          ).attemptCount,
        ).toBe(0);
    },
  );
});
