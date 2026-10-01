import { randomUUID } from "node:crypto";
import { PrismaService } from "../src/prisma.service";
import {
  PrismaDocumentRepository,
  PrismaDocumentChunkRepository,
  PrismaDocumentGenerationRepository,
  PrismaDocumentProcessingJobRepository,
  PrismaDocumentEmbeddingRepository,
} from "../src/persistence/document.persistence";
import { Document } from "../src/modules/document/domain/entities/document.entity";
import { DocumentChunk } from "../src/modules/document/domain/entities/document-chunk.entity";
const db = new PrismaService();
const user = randomUUID();
const other = randomUUID();
const repo = new PrismaDocumentRepository(db);
const chunks = new PrismaDocumentChunkRepository(db);
const generations = new PrismaDocumentGenerationRepository(db);
const jobs = new PrismaDocumentProcessingJobRepository(db);
const embeddings = new PrismaDocumentEmbeddingRepository(db);
const at = new Date("2026-10-02T08:00:00+07:00");

async function create() {
  const id = randomUUID();
  const d = Document.create({
    id,
    userId: user,
    originalFilename: "private.txt",
    storageFilename: id + ".txt",
    mimeType: "text/plain",
    sizeBytes: 12n,
    s3Bucket: "test-private",
    s3Key: "test/" + id,
    createdAt: at,
  });
  await repo.insert(d);
  return d;
}
async function processing() {
  const d = await create();
  d.markUploaded(at);
  expect(await repo.save(d, 0)).toBe(true);
  const generation = await repo.startGeneration(
    d.state.id,
    user,
    1,
    randomUUID(),
    at,
  );
  expect(generation).toBe(1);
  return d.state.id;
}
async function chunk(id: string, index = 0) {
  const c = DocumentChunk.create({
    id: randomUUID(),
    documentId: id,
    generation: 1,
    chunkIndex: index,
    content: "Vietnamese document text",
    tokenCount: 5,
    locator: { kind: "LINE", start: 1, end: 2 },
    createdAt: at,
  });
  await chunks.insert(c, user);
  return c;
}
describe("Document generation persistence on isolated PostgreSQL", () => {
  beforeAll(async () => {
    const rows = await db.$queryRaw<
      Array<{ name: string }>
    >`SELECT current_database() AS name`;
    if (!/_test$|_ci$/.test(rows[0]?.name ?? ""))
      throw new Error("Persistence suite requires a dedicated *_test database");
  });
  afterEach(async () => {
    await db.document.deleteMany({ where: { userId: user } });
  });
  afterAll(() => db.$disconnect());
  it("round-trips bigint, UTC timestamps and owner identity", async () => {
    const d = await create();
    const read = await repo.findByIdAndUserId(d.state.id, user);
    expect(read?.state.sizeBytes).toBe(12n);
    expect(read?.state.createdAt.toISOString()).toBe(
      "2026-10-02T01:00:00.000Z",
    );
    expect(await repo.findByIdAndUserId(d.state.id, other)).toBeNull();
    expect(await repo.findByUserId(other)).toEqual([]);
  });
  it("enforces unique object identity and rejects illegal direct lifecycle changes", async () => {
    const d = await create();
    await expect(
      db.document.create({ data: { ...d.state, id: randomUUID() } }),
    ).rejects.toThrow();
    await expect(
      db.document.update({
        where: { id: d.state.id },
        data: { status: "FAILED" },
      }),
    ).rejects.toThrow();
    await expect(
      db.document.update({
        where: { id: d.state.id },
        data: { userId: other },
      }),
    ).rejects.toThrow();
  });
  it("atomically creates one generation and job under concurrent starts", async () => {
    const d = await create();
    d.markUploaded(at);
    await repo.save(d, 0);
    const results = await Promise.all([
      repo.startGeneration(d.state.id, user, 1, randomUUID(), at),
      repo.startGeneration(d.state.id, user, 1, randomUUID(), at),
    ]);
    expect(results.sort()).toEqual([1, null].sort());
    expect(
      await db.documentProcessingJob.count({
        where: { documentId: d.state.id },
      }),
    ).toBe(1);
    expect(
      (await generations.findByDocumentAndUserId(d.state.id, user, 1))?.state
        .generation,
    ).toBe(1);
    expect(
      (await jobs.findByDocumentAndUserId(d.state.id, user, 1))?.state,
    ).toMatchObject({ status: "PENDING", attemptCount: 0, leaseOwner: null });
    expect(await jobs.findByDocumentAndUserId(d.state.id, other, 1)).toBeNull();
    expect(
      await generations.findByDocumentAndUserId(d.state.id, other, 1),
    ).toBeNull();
  });
  it("rolls back the document and generation when the job insert fails", async () => {
    const id = await processing();
    const existingJob = await jobs.findByDocumentAndUserId(id, user, 1);
    const second = await create();
    second.markUploaded(at);
    await repo.save(second, 0);
    await expect(
      repo.startGeneration(second.state.id, user, 1, existingJob!.state.id, at),
    ).rejects.toThrow();
    expect(
      (await repo.findByIdAndUserId(second.state.id, user))?.state.status,
    ).toBe("UPLOADED");
    expect(
      await generations.findByDocumentAndUserId(second.state.id, user, 1),
    ).toBeNull();
  });
  it("round-trips locators and rejects duplicate indexes and cross-owner writes", async () => {
    const id = await processing();
    const c = await chunk(id);
    expect(
      (await chunks.findByDocumentAndUserId(id, user, 1))[0].state,
    ).toEqual(c.state);
    expect(await chunks.findByDocumentAndUserId(id, other, 1)).toEqual([]);
    await expect(chunk(id)).rejects.toThrow();
    await expect(
      chunks.insert(
        DocumentChunk.create({ ...c.state, id: randomUUID(), chunkIndex: 1 }),
        other,
      ),
    ).rejects.toThrow();
    await expect(
      db.documentChunk.create({
        data: {
          id: randomUUID(),
          documentId: id,
          generation: 99,
          chunkIndex: 1,
          content: "text",
          createdAt: at,
        },
      }),
    ).rejects.toThrow();
  });
  it("persists embedding metadata without vector and refuses incomplete activation", async () => {
    const id = await processing();
    const c = await chunk(id);
    const e = {
      id: randomUUID(),
      chunkId: c.state.id,
      embeddingModel: "fixture",
      modelVersion: "v1",
      dimensions: 2,
      createdAt: at,
    };
    await expect(embeddings.insertMetadata(e, other)).rejects.toThrow();
    await embeddings.insertMetadata(e, user);
    expect(await embeddings.findByChunkAndUserId(c.state.id, user)).toEqual(e);
    expect(await embeddings.findByChunkAndUserId(c.state.id, other)).toBeNull();
    expect(await repo.activateGeneration(id, user, 1, 2, at)).toBe(false);
    await expect(
      db.document.update({
        where: { id },
        data: { status: "READY", activeGeneration: 1 },
      }),
    ).rejects.toThrow();
  });
  it("activates only complete current generations and preserves generation-specific indexes", async () => {
    const id = await processing();
    const c = await chunk(id);
    await embeddings.insertMetadata(
      {
        id: randomUUID(),
        chunkId: c.state.id,
        embeddingModel: "fixture",
        modelVersion: "v1",
        dimensions: 2,
        createdAt: at,
      },
      user,
    );
    // Infrastructure fixture only: real embedding/vector writes belong to Branch 5.
    await db.$executeRaw`UPDATE document_embeddings SET embedding = '[0.1,0.2]'::vector WHERE chunk_id = ${c.state.id}::uuid`;
    expect(await repo.activateGeneration(id, other, 1, 2, at)).toBe(false);
    expect(await repo.activateGeneration(id, user, 2, 2, at)).toBe(false);
    expect(await repo.activateGeneration(id, user, 1, 2, at)).toBe(true);
    expect((await repo.findByIdAndUserId(id, user))?.state).toMatchObject({
      status: "READY",
      activeGeneration: 1,
      revision: 3,
    });
    expect(await repo.startGeneration(id, user, 3, randomUUID(), at)).toBe(2);
    const second = DocumentChunk.create({
      ...c.state,
      id: randomUUID(),
      generation: 2,
    });
    await chunks.insert(second, user);
    expect(await db.documentChunk.count({ where: { documentId: id } })).toBe(2);
    expect(await repo.activateGeneration(id, user, 1, 4, at)).toBe(false);
  });
  it("enforces job lease, attempt, error, embedding dimension and locator constraints", async () => {
    const id = await processing();
    const c = await chunk(id);
    const job = await jobs.findByDocumentAndUserId(id, user, 1);
    for (const data of [
      { status: "RUNNING" as const },
      { attemptCount: -1 },
      { errorCode: "private document contents" },
    ])
      await expect(
        db.documentProcessingJob.update({ where: { id: job!.state.id }, data }),
      ).rejects.toThrow();
    await expect(
      db.documentChunk.update({
        where: { id: c.state.id },
        data: { locatorEnd: 0 },
      }),
    ).rejects.toThrow();
    await expect(
      db.documentEmbedding.create({
        data: {
          id: randomUUID(),
          chunkId: c.state.id,
          embeddingModel: "fixture",
          modelVersion: "v1",
          dimensions: 0,
          createdAt: at,
        },
      }),
    ).rejects.toThrow();
  });
  it("soft deletion hides every owner query and stale writes cannot resurrect documents", async () => {
    const id = await processing();
    const c = await chunk(id);
    const d = (await repo.findByIdAndUserId(id, user))!;
    d.delete(at);
    expect(await repo.save(d, 2)).toBe(true);
    expect(await repo.findByIdAndUserId(id, user)).toBeNull();
    expect(await chunks.findByDocumentAndUserId(id, user, 1)).toEqual([]);
    expect(await jobs.findByDocumentAndUserId(id, user, 1)).toBeNull();
    expect(await generations.findByDocumentAndUserId(id, user, 1)).toBeNull();
    expect(await embeddings.findByChunkAndUserId(c.state.id, user)).toBeNull();
    expect(await repo.save(d, 2)).toBe(false);
    expect(
      await repo.startGeneration(id, user, 3, randomUUID(), at),
    ).toBeNull();
  });
});
