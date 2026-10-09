import { Test } from "@nestjs/testing";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule, JwtService } from "@nestjs/jwt";
import request from "supertest";
import { DocumentRetrievalController } from "../src/modules/document/presentation/document-retrieval.controller";
import { DocumentRetrievalUseCases } from "../src/modules/document/application/use-cases/document-retrieval.use-cases";
import { PrismaDocumentRetrievalRepository } from "../src/persistence/document-retrieval.repository";
import { JwtAuthGuard } from "../src/auth/jwt-auth.guard";
import { PrismaDocumentVectorIndex } from "../src/persistence/document-vector-index";
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
function extracted(lease: ProcessingLease) {
  return {
    kind: "extracted" as const,
    chunks: prepared(lease).chunks,
    processingVersion: "extraction-v1/test-estimator",
    sourceChecksumSha256: lease.source.checksumSha256,
    sourceVersionId: lease.source.versionId,
  };
}
describe("Durable fenced processing on real PostgreSQL", () => {
  it("atomically stages chunks and source identity without activating READY or vectors", async () => {
    const lease = await claimed();
    const result = extracted(lease);
    expect(await jobs.stageExtraction(lease, result)).toBe(true);
    expect(await jobs.stageExtraction(lease, result)).toBe(false);
    const d = await db.document.findUniqueOrThrow({
      where: { id: lease.documentId },
      include: { generations: true, chunks: true, jobs: true },
    });
    expect(d).toMatchObject({ status: "PROCESSING", activeGeneration: null });
    expect(d.generations[0]).toMatchObject({
      status: "EXTRACTED",
      chunkCount: 1,
      processingVersion: result.processingVersion,
      sourceChecksumSha256: lease.source.checksumSha256,
      sourceVersionId: lease.source.versionId,
      completedAt: null,
    });
    expect(d.generations[0].extractedAt?.toISOString()).toMatch(/Z$/);
    expect(d.chunks).toHaveLength(1);
    expect(d.jobs[0]).toMatchObject({
      status: "SUCCEEDED",
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    expect(
      await db.documentEmbedding.count({
        where: { chunk: { documentId: d.id } },
      }),
    ).toBe(0);
    const events = await db.outboxEvent.findMany({
      where: { aggregateId: d.id },
    });
    expect(
      events.filter((e) => e.eventType === "document.processing.extracted"),
    ).toHaveLength(1);
    expect(
      events.some((e) => e.eventType === "document.processing.ready"),
    ).toBe(false);
    const payload = JSON.stringify(events);
    expect(payload).not.toContain(result.sourceChecksumSha256);
    expect(payload).not.toContain("hello!");
    expect(await jobs.claim("another-worker")).toBeNull();
  });
  it("rejects stale/deleted extraction and mismatched committed identity", async () => {
    const lease = await claimed(),
      result = extracted(lease);
    expect(
      await jobs.stageExtraction({ ...lease, token: lease.token + 1 }, result),
    ).toBe(false);
    await expect(
      jobs.stageExtraction(lease, {
        ...result,
        sourceChecksumSha256: "b".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_PROCESSING_RESULT_INVALID" });
    expect(
      await uploads.deleteAndScheduleCleanup(
        lease.documentId,
        userId,
        new Date(),
      ),
    ).toBe(true);
    expect(await jobs.stageExtraction(lease, result)).toBe(false);
    expect(
      await db.documentChunk.count({ where: { documentId: lease.documentId } }),
    ).toBe(0);
  });
  it("rolls back extraction chunks/state when outbox writing fails", async () => {
    const lease = await claimed();
    await fault("document.processing.extracted", lease.documentId, async () => {
      await expect(
        jobs.stageExtraction(lease, extracted(lease)),
      ).rejects.toThrow();
    });
    expect(
      await db.documentChunk.count({ where: { documentId: lease.documentId } }),
    ).toBe(0);
    expect(
      (
        await db.documentProcessingJob.findUniqueOrThrow({
          where: { id: lease.id },
        })
      ).status,
    ).toBe("RUNNING");
    expect(
      (
        await db.documentGeneration.findUniqueOrThrow({
          where: {
            documentId_generation: {
              documentId: lease.documentId,
              generation: lease.generation,
            },
          },
        })
      ).status,
    ).toBe("PROCESSING");
    expect(await jobs.stageExtraction(lease, extracted(lease))).toBe(true);
  });
  it("cancels an extracted generation on deletion and forbids activating it without embeddings", async () => {
    const lease = await claimed();
    expect(await jobs.stageExtraction(lease, extracted(lease))).toBe(true);
    await expect(
      db.document.update({
        where: { id: lease.documentId },
        data: { status: "READY", activeGeneration: lease.generation },
      }),
    ).rejects.toThrow();
    expect(
      await uploads.deleteAndScheduleCleanup(
        lease.documentId,
        userId,
        new Date(),
      ),
    ).toBe(true);
    expect(
      (
        await db.documentGeneration.findUniqueOrThrow({
          where: {
            documentId_generation: {
              documentId: lease.documentId,
              generation: lease.generation,
            },
          },
        })
      ).status,
    ).toBe("FAILED");
  });
  async function stagedForIndexing() {
    const first = await claimed();
    const result = extracted(first);
    result.chunks.push(
      DocumentChunk.create({
        id: randomUUID(),
        documentId: first.documentId,
        generation: first.generation,
        chunkIndex: 1,
        content: "second paragraph",
        tokenCount: 16,
        locator: { kind: "LINE", start: 2, end: 2 },
      }),
    );
    expect(await jobs.stageExtraction(first, result, true)).toBe(true);
    const lease = (await jobs.claim("embedding-worker"))!;
    expect(lease.documentId).toBe(first.documentId);
    expect(lease.token).toBeGreaterThan(first.token);
    const extraction = (await jobs.loadExtraction(lease))!;
    const output = {
      chunks: extraction.chunks,
      embeddings: extraction.chunks.map((c, i) =>
        DocumentEmbedding.create({
          id: randomUUID(),
          chunkId: c.state.id,
          embeddingModel: "test-fixture",
          modelVersion: "test-v1",
          embedding: i === 0 ? [1, 0] : [0, 1],
        }),
      ),
      embeddingSettings: {
        inputPolicy: "plain-text-v1",
        batchSize: 2,
        maxInputTokens: 128,
        tokenEstimator: "utf8-byte-upper-bound-v1",
      },
    };
    return { lease, extraction, output };
  }
  it("indexes staged chunks atomically and performs exact cosine queries only in the owned active embedding space", async () => {
    const { lease, output } = await stagedForIndexing();
    expect(await jobs.publish(lease, output)).toBe(true);
    const d = await db.document.findUniqueOrThrow({
      where: { id: lease.documentId },
      include: { generations: true, chunks: true },
    });
    expect(d).toMatchObject({ status: "READY", activeGeneration: 1 });
    expect(d.generations[0]).toMatchObject({
      status: "COMPLETE",
      embeddingModel: "test-fixture",
      embeddingVersion: "test-v1",
      embeddingDimensions: 2,
      embeddingSettings: output.embeddingSettings,
    });
    expect(d.chunks.map((c) => c.id).sort()).toEqual(
      output.chunks.map((c) => c.state.id).sort(),
    );
    expect(d.generations[0].completedAt?.toISOString()).toMatch(/Z$/);
    const stored = await db.$queryRaw<
      Array<{ dimensions: number; norm: number }>
    >`SELECT vector_dims(e.embedding) AS dimensions, vector_norm(e.embedding) AS norm
      FROM document_embeddings e JOIN document_chunks c ON c.id=e.chunk_id WHERE c.document_id=${d.id}::uuid`;
    expect(stored).toEqual([
      { dimensions: 2, norm: 1 },
      { dimensions: 2, norm: 1 },
    ]);
    const index = new PrismaDocumentVectorIndex(db);
    const query = {
      userId,
      space: { model: "test-fixture", version: "test-v1", dimensions: 2 },
      vector: [1, 0],
      topK: 2,
    };
    const found = await index.search(query);
    expect(found.map((m) => m.distance)).toEqual([0, 1]);
    expect(found[0].chunkId).toBe(output.chunks[0].state.id);
    expect(await index.search({ ...query, userId: randomUUID() })).toEqual([]);
    expect(
      await index.search({
        ...query,
        space: { ...query.space, version: "changed" },
      }),
    ).toEqual([]);
    expect(
      await index.search({
        ...query,
        space: { ...query.space, dimensions: 3 },
        vector: [1, 0, 0],
      }),
    ).toEqual([]);
    await db.documentGeneration.update({
      where: { documentId_generation: { documentId: d.id, generation: 1 } },
      data: { embeddingSettings: { inputPolicy: "legacy" } },
    });
    expect(await index.search(query)).toEqual([]);
    await db.documentGeneration.update({
      where: { documentId_generation: { documentId: d.id, generation: 1 } },
      data: { embeddingSettings: output.embeddingSettings },
    });
    await uploads.deleteAndScheduleCleanup(d.id, userId, new Date());
    expect(await index.search(query)).toEqual([]);
  });
  it("serves authenticated retrieval HTTP with SQL ownership, stable sources, bounds and safe 404s", async () => {
    const { lease, output } = await stagedForIndexing();
    expect(await jobs.publish(lease, output)).toBe(true);
    const space = { model: "test-fixture", version: "test-v1", dimensions: 2 };
    const provider = {
      embed: jest
        .fn()
        .mockResolvedValue({ space, items: [{ id: "query", vector: [1, 0] }] }),
    };
    const index = new PrismaDocumentVectorIndex(db);
    const retrieval = new DocumentRetrievalUseCases(
      new PrismaDocumentRetrievalRepository(db),
      index,
      provider,
      { space, timeoutMs: 1000, minSimilarity: 0.55 },
    );
    const secret = "retrieval-integration-test-secret-32chars";
    const config = {
      JWT_ACCESS_SECRET: secret,
      JWT_ISSUER: "test-identity",
      JWT_AUDIENCE: "test-client",
    };
    const ref = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      controllers: [DocumentRetrievalController],
      providers: [
        JwtAuthGuard,
        {
          provide: ConfigService,
          useValue: { getOrThrow: (key: keyof typeof config) => config[key] },
        },
        { provide: DocumentRetrievalUseCases, useValue: retrieval },
      ],
    }).compile();
    const app = ref.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    const jwt = ref.get(JwtService);
    const token = (sub: string) =>
      jwt.sign(
        { sub, sessionId: "session", tokenType: "access" },
        {
          secret,
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
          expiresIn: "5m",
        },
      );
    const owner = token(userId),
      stranger = token(randomUUID());
    const search = (auth: string, body: object) =>
      request(app.getHttpServer())
        .post("/internal/documents/search")
        .set("Authorization", "Bearer " + auth)
        .send(body);
    const path = `/internal/documents/${lease.documentId}/chunks`;
    try {
      await request(app.getHttpServer())
        .post("/internal/documents/search")
        .send({ query: "hello" })
        .expect(401);
      await request(app.getHttpServer())
        .get(path)
        .set("x-user-id", userId)
        .expect(401);
      await search(owner, { query: "   " }).expect(400);
      await search(owner, { query: "hello", topK: 21 }).expect(400);
      await search(owner, { query: "hello", vector: [1, 0] }).expect(400);
      await search(owner, { query: "hello", documentIds: null }).expect(400);
      const found = await search(owner, {
        query: "hello",
        documentIds: [lease.documentId],
      }).expect(200);
      expect(found.body.items).toHaveLength(1);
      expect(found.body.items[0]).toMatchObject({
        documentId: lease.documentId,
        generation: 1,
        filename: "notes.txt",
        excerpt: "hello!",
        similarity: 1,
        locator: { kind: "LINE", start: 1, end: 1 },
      });
      expect(JSON.stringify(found.body)).not.toMatch(
        /s3Key|storageVersion|signedUrl/,
      );
      expect(
        (await search(stranger, { query: "hello" }).expect(200)).body,
      ).toEqual({ items: [] });
      const foreign = await search(stranger, {
        query: "hello",
        documentIds: [lease.documentId],
      }).expect(404);
      const missing = await search(owner, {
        query: "hello",
        documentIds: [randomUUID()],
      }).expect(404);
      expect(foreign.body).toEqual(missing.body);
      const get = (url: string, auth = owner) =>
        request(app.getHttpServer())
          .get(url)
          .set("Authorization", "Bearer " + auth);
      const page = await get(path + "?limit=1").expect(200);
      expect(page.body.next).toEqual({ generation: 1, after: 0 });
      const next = await get(path + "?limit=1&generation=1&after=0").expect(
        200,
      );
      expect(next.body.items[0].content).toBe("second paragraph");
      expect(next.body.next).toBeNull();
      await get(path + "?after=0").expect(400);
      await get(path + "?generation=2").expect(404);
      await get(path, stranger).expect(404);
      const chunk = output.chunks[0].state.id;
      await get(path + "/" + chunk).expect(200);
      await get(path + "/" + chunk, stranger).expect(404);
      await get(path + "/" + randomUUID()).expect(404);
      const query = { userId, space, vector: [1, 0], topK: 2 };
      expect(await index.search({ ...query, documentIds: [] })).toEqual([]);
      expect(
        await index.search({ ...query, documentIds: [randomUUID()] }),
      ).toEqual([]);
      await db.document.update({
        where: { id: lease.documentId },
        data: { status: "PROCESSING", processingGeneration: 2 },
      });
      expect(await index.search(query)).toEqual([]);
      await get(path).expect(404);
      // Simulate a completed reindex while retaining the old generation and its vectors.
      await db.documentGeneration.create({
        data: {
          documentId: lease.documentId,
          generation: 2,
          status: "COMPLETE",
          chunkCount: 1,
          createdAt: new Date(),
          completedAt: new Date(),
          embeddingModel: space.model,
          embeddingVersion: space.version,
          embeddingDimensions: 2,
          embeddingSettings: output.embeddingSettings,
        },
      });
      const replacement = randomUUID();
      await db.documentChunk.create({
        data: {
          id: replacement,
          documentId: lease.documentId,
          generation: 2,
          chunkIndex: 0,
          content: "replacement",
          tokenCount: 3,
          locatorKind: "LINE",
          locatorStart: 1,
          locatorEnd: 1,
          createdAt: new Date(),
        },
      });
      await db.$executeRaw`INSERT INTO document_embeddings(id,chunk_id,embedding_model,model_version,dimensions,embedding,created_at)
        VALUES (${randomUUID()}::uuid,${replacement}::uuid,${space.model},${space.version},2,'[1,0]'::vector,clock_timestamp())`;
      await db.document.update({
        where: { id: lease.documentId },
        data: { status: "READY", activeGeneration: 2 },
      });
      const active = await search(owner, { query: "hello" }).expect(200);
      expect(active.body.items).toHaveLength(1);
      expect(active.body.items[0]).toMatchObject({
        generation: 2,
        chunkId: replacement,
      });
      await get(path + "?generation=1&after=0").expect(404);
      await get(path + "/" + chunk).expect(404);
      await uploads.deleteAndScheduleCleanup(
        lease.documentId,
        userId,
        new Date(),
      );
      expect(
        (await search(owner, { query: "hello" }).expect(200)).body,
      ).toEqual({ items: [] });
      await get(path).expect(404);
    } finally {
      await app.close();
    }
  });
  it("rejects partial batches, retries embeddings from the same staged chunks and emits READY once", async () => {
    const { lease, output } = await stagedForIndexing();
    await expect(
      jobs.publish(lease, {
        ...output,
        embeddings: output.embeddings.slice(0, 1),
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_PROCESSING_RESULT_INVALID" });
    expect(
      await db.documentEmbedding.count({
        where: { chunk: { documentId: lease.documentId } },
      }),
    ).toBe(0);
    expect(await jobs.fail(lease, "DOCUMENT_EMBEDDING_UNAVAILABLE")).toBe(true);
    await due(lease.id);
    const retried = (await jobs.claim("retry-indexer"))!;
    const loaded = (await jobs.loadExtraction(retried))!;
    expect(loaded.chunks.map((c) => c.state.id)).toEqual(
      output.chunks.map((c) => c.state.id),
    );
    expect(await jobs.publish(lease, output)).toBe(false);
    expect(await jobs.publish(retried, output)).toBe(true);
    expect(await jobs.publish(retried, output)).toBe(false);
    expect(
      await db.outboxEvent.count({
        where: {
          aggregateId: lease.documentId,
          eventType: "document.processing.ready",
        },
      }),
    ).toBe(1);
  });
  it("recovers interrupted indexing with lease fencing and rejects deleted results", async () => {
    const { lease, output } = await stagedForIndexing();
    await db.documentProcessingJob.update({
      where: { id: lease.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    expect(await jobs.claim("recovery-scheduler")).toBeNull();
    await due(lease.id);
    const recovered = (await jobs.claim("recovered-indexer"))!;
    expect(
      (await jobs.loadExtraction(recovered))!.chunks.map((c) => c.state.id),
    ).toEqual(output.chunks.map((c) => c.state.id));
    expect(await jobs.publish(lease, output)).toBe(false);
    await uploads.deleteAndScheduleCleanup(
      lease.documentId,
      userId,
      new Date(),
    );
    expect(await jobs.publish(recovered, output)).toBe(false);
    expect(
      await db.documentEmbedding.count({
        where: { chunk: { documentId: lease.documentId } },
      }),
    ).toBe(0);
  });
  it("rolls back all embeddings and activation when completion outbox fails", async () => {
    const { lease, output } = await stagedForIndexing();
    await fault("document.processing.ready", lease.documentId, async () => {
      await expect(jobs.publish(lease, output)).rejects.toThrow();
    });
    expect(
      await db.documentEmbedding.count({
        where: { chunk: { documentId: lease.documentId } },
      }),
    ).toBe(0);
    expect(
      (
        await db.documentGeneration.findUniqueOrThrow({
          where: {
            documentId_generation: {
              documentId: lease.documentId,
              generation: lease.generation,
            },
          },
        })
      ).status,
    ).toBe("EXTRACTED");
    expect(await jobs.publish(lease, output)).toBe(true);
    const event = await db.outboxEvent.findFirstOrThrow({
      where: {
        aggregateId: lease.documentId,
        eventType: "document.processing.ready",
      },
    });
    expect(JSON.stringify(event)).not.toContain("second paragraph");
    expect(JSON.stringify(event)).not.toContain("test-fixture");
  });
  it("requires durable staged extraction before configured runtime indexing can activate READY", async () => {
    const lease = await claimed();
    const configured = new PrismaDocumentProcessingRepository(db, {
      ...limits,
      embeddingSpace: {
        model: "test-fixture",
        version: "test-v1",
        dimensions: 2,
      },
    });
    await expect(
      configured.publish(lease, prepared(lease)),
    ).rejects.toMatchObject({ code: "DOCUMENT_PROCESSING_RESULT_INVALID" });
    expect(
      await db.documentChunk.count({ where: { documentId: lease.documentId } }),
    ).toBe(0);
    expect(
      (await db.document.findUniqueOrThrow({ where: { id: lease.documentId } }))
        .status,
    ).toBe("PROCESSING");
  });
  it("rejects mismatched model identity, tampered chunks and invalid pgvector values", async () => {
    const { lease, output } = await stagedForIndexing();
    const configured = new PrismaDocumentProcessingRepository(db, {
      ...limits,
      embeddingSpace: { model: "different", version: "test-v1", dimensions: 2 },
    });
    await expect(configured.publish(lease, output)).rejects.toMatchObject({
      code: "DOCUMENT_EMBEDDING_MODEL_MISMATCH",
    });
    const changed = DocumentChunk.create({
      ...output.chunks[0].state,
      content: "altered",
    });
    await expect(
      jobs.publish(lease, { ...output, chunks: [changed, output.chunks[1]] }),
    ).rejects.toMatchObject({ code: "DOCUMENT_PROCESSING_RESULT_INVALID" });
    const mixed = DocumentEmbedding.create({
      ...output.embeddings[1].state,
      modelVersion: "other",
    });
    await expect(
      jobs.publish(lease, {
        ...output,
        embeddings: [output.embeddings[0], mixed],
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_PROCESSING_RESULT_INVALID" });
    const id = randomUUID(),
      chunk = output.chunks[0].state.id;
    await expect(db.$executeRaw`INSERT INTO document_embeddings(id,chunk_id,embedding_model,model_version,dimensions,embedding,created_at)
      VALUES(${id}::uuid,${chunk}::uuid,'test','v1',3,'[1,0]'::vector,clock_timestamp())`).rejects.toThrow();
    await expect(db.$executeRaw`INSERT INTO document_embeddings(id,chunk_id,embedding_model,model_version,dimensions,embedding,created_at)
      VALUES(${id}::uuid,${chunk}::uuid,'test','v1',2,'[0,0]'::vector,clock_timestamp())`).rejects.toThrow();
    await expect(db.$queryRaw`SELECT '[NaN,1]'::vector`).rejects.toThrow();
    expect(
      (await db.document.findUniqueOrThrow({ where: { id: lease.documentId } }))
        .status,
    ).toBe("PROCESSING");
  });
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
  it.each(["ready", "extracted"] as const)(
    "rolls back prepared output if the lease expires during %s publication",
    async (stage) => {
      const lease = await claimed();
      await db.$executeRawUnsafe(`CREATE FUNCTION test_delay_document_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.aggregate_id='${lease.documentId}'::uuid AND NEW.event_type='document.processing.${stage}'
      THEN PERFORM pg_sleep(0.2); END IF; RETURN NEW; END $$`);
      await db.$executeRawUnsafe(
        "CREATE TRIGGER test_delay_document_event BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION test_delay_document_event()",
      );
      try {
        await db.$executeRaw`UPDATE document_processing_jobs SET lease_expires_at=clock_timestamp()+interval '100 milliseconds' WHERE id=${lease.id}::uuid`;
        expect(
          await (stage === "ready"
            ? jobs.publish(lease, prepared(lease))
            : jobs.stageExtraction(lease, extracted(lease))),
        ).toBe(false);
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
              eventType: `document.processing.${stage}`,
            },
          }),
        ).toBe(0);
      } finally {
        await db.$executeRawUnsafe(
          "DROP TRIGGER test_delay_document_event ON outbox_events",
        );
        await db.$executeRawUnsafe("DROP FUNCTION test_delay_document_event()");
      }
    },
  );
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
