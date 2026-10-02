import { randomUUID, createHash } from "node:crypto";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import request from "supertest";
import {
  S3Client,
  CreateBucketCommand,
  PutBucketVersioningCommand,
  PutPublicAccessBlockCommand,
  PutObjectCommand,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
  DeleteBucketCommand,
  GetPublicAccessBlockCommand,
} from "@aws-sdk/client-s3";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma.service";
import { DOCUMENT_REPOSITORY } from "../src/application/repositories/document.repositories";
import { DOCUMENT_UPLOAD_REPOSITORY } from "../src/application/ports/document-upload.repository";
import { DOCUMENT_STORAGE } from "../src/application/ports/document-storage.port";
import { DocumentUploadUseCases } from "../src/application/services/document-upload.use-cases";
import { S3DocumentStorage } from "../src/infrastructure/storage/s3-document-storage";

const userId = randomUUID();
const otherId = randomUUID();
const bucket = process.env.DOCUMENT_S3_BUCKET!;
const endpoint = process.env.AWS_ENDPOINT_URL!;
const s3 = new S3Client({
  endpoint,
  region: process.env.AWS_REGION!,
  forcePathStyle: true,
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});
const body = Buffer.from("hello!");
const sha = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
type Proposal = {
  document: { id: string };
  upload: { url: string; fields: Record<string, string> };
};

describe("Private upload API with real PostgreSQL and LocalStack S3", () => {
  jest.setTimeout(60000);
  let app: INestApplication;
  let db: PrismaService;
  let token: string;
  let otherToken: string;
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(endpoint).hostname))
      throw new Error("Storage suite requires local test S3");
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    db = app.get(PrismaService);
    const names = await db.$queryRaw<
      Array<{ name: string }>
    >`SELECT current_database() AS name`;
    if (!/_test$|_ci$/.test(names[0]?.name ?? ""))
      throw new Error("Dedicated test database required");
    await s3.send(
      new CreateBucketCommand({
        Bucket: bucket,
        CreateBucketConfiguration: { LocationConstraint: "ap-southeast-1" },
      }),
    );
    await s3.send(
      new PutBucketVersioningCommand({
        Bucket: bucket,
        VersioningConfiguration: { Status: "Enabled" },
      }),
    );
    await s3.send(
      new PutPublicAccessBlockCommand({
        Bucket: bucket,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true,
        },
      }),
    );
    const options = {
      secret: process.env.JWT_ACCESS_SECRET,
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
    };
    token = await app
      .get(JwtService)
      .signAsync(
        { sub: userId, sessionId: "storage", tokenType: "access" },
        options,
      );
    otherToken = await app
      .get(JwtService)
      .signAsync(
        { sub: otherId, sessionId: "storage-other", tokenType: "access" },
        options,
      );
  });
  async function clearObjects() {
    let keyMarker: string | undefined;
    let versionMarker: string | undefined;
    do {
      const objects = await s3.send(
        new ListObjectVersionsCommand({
          Bucket: bucket,
          KeyMarker: keyMarker,
          VersionIdMarker: versionMarker,
        }),
      );
      const rows = [
        ...(objects.Versions ?? []),
        ...(objects.DeleteMarkers ?? []),
      ].map((x) => ({ Key: x.Key!, VersionId: x.VersionId! }));
      if (rows.length)
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: rows },
          }),
        );
      keyMarker = objects.NextKeyMarker;
      versionMarker = objects.NextVersionIdMarker;
    } while (keyMarker);
  }
  afterEach(async () => {
    if (db)
      await db.document.deleteMany({
        where: { userId: { in: [userId, otherId] } },
      });
    await clearObjects();
  });
  afterAll(async () => {
    await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
    s3.destroy();
    await app?.close();
  });
  async function propose(
    overrides: Record<string, unknown> = {},
  ): Promise<Proposal> {
    const response = await request(app.getHttpServer())
      .post("/documents/upload-url")
      .set("Authorization", `Bearer ${token}`)
      .send({
        filename: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: body.length,
        ...overrides,
      })
      .expect(201);
    return response.body as Proposal;
  }
  async function upload(p: Proposal, bytes = body) {
    const form = new FormData();
    for (const [key, value] of Object.entries(p.upload.fields))
      form.append(key, value);
    form.append("file", new Blob([new Uint8Array(bytes)]), "file.txt");
    return fetch(p.upload.url, { method: "POST", body: form });
  }
  const complete = (p: Proposal, bearer = token) =>
    request(app.getHttpServer())
      .post(`/documents/${p.document.id}/upload-complete`)
      .set("Authorization", `Bearer ${bearer}`);
  it("uploads, verifies, lists and downloads real private bytes with safe disposition", async () => {
    const p = await propose({
      filename: "ghi chú.txt",
      checksumSha256: sha(body),
    });
    expect(p.upload.fields.key).toMatch(
      new RegExp(`^users/${userId}/documents/${p.document.id}/`),
    );
    const policy = JSON.parse(
      Buffer.from(p.upload.fields.Policy, "base64").toString(),
    ) as { expiration: string };
    const metadata = await db.document.findUniqueOrThrow({
      where: { id: p.document.id },
    });
    expect(new Date(policy.expiration).getTime()).toBeLessThanOrEqual(
      metadata.uploadExpiresAt!.getTime(),
    );
    expect((await upload(p)).status).toBe(204);
    const response = await complete(p).expect(200);
    expect(response.body).toMatchObject({
      status: "UPLOADED",
      checksumSha256: sha(body),
      sizeBytes: body.length,
    });
    expect(response.body).not.toHaveProperty("s3Key");
    const list = await request(app.getHttpServer())
      .get("/documents")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(list.body.map((d: { id: string }) => d.id)).toContain(p.document.id);
    const result = await request(app.getHttpServer())
      .get(`/documents/${p.document.id}/download-url`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const downloaded = await fetch(result.body.url);
    expect(downloaded.status).toBe(200);
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(body);
    expect(downloaded.headers.get("content-disposition")).toContain(
      "attachment;",
    );
    const block = await s3.send(
      new GetPublicAccessBlockCommand({ Bucket: bucket }),
    );
    expect(Object.values(block.PublicAccessBlockConfiguration!)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(new URL(result.body.url).searchParams.get("versionId")).toBeTruthy();
  });
  // Community LocalStack 4.8 does not enforce IAM/anonymous access denial.
  // Opt in only on a local S3 environment that implements that security boundary.
  (process.env.DOCUMENT_STORAGE_ASSERT_PRIVATE === "true" ? it : it.skip)(
    "rejects anonymous object reads on IAM-enforcing S3",
    async () => {
      const p = await propose();
      await upload(p);
      await complete(p).expect(200);
      const unsigned = `${endpoint}/${bucket}/${p.upload.fields.key}`;
      expect((await fetch(unsigned)).status).toBe(403);
    },
  );
  it("handles repeated/concurrent completion and pins identity after overwrite", async () => {
    const p = await propose();
    await upload(p);
    const results = await Promise.all([complete(p), complete(p)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const stored = await db.document.findUniqueOrThrow({
      where: { id: p.document.id },
    });
    expect(stored.revision).toBe(1);
    expect((await upload(p, Buffer.from("change"))).status).toBe(204);
    expect((await complete(p).expect(200)).body.checksumSha256).toBe(sha(body));
    const result = await request(app.getHttpServer())
      .get(`/documents/${p.document.id}/download-url`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(
      Buffer.from(await (await fetch(result.body.url)).arrayBuffer()),
    ).toEqual(body);
    await expect(
      db.document.update({
        where: { id: stored.id },
        data: { storageVersionId: "different" },
      }),
    ).rejects.toThrow();
  });
  it("rejects absent objects and uncompleted downloads", async () => {
    const p = await propose();
    expect((await complete(p).expect(404)).body.code).toBe(
      "DOCUMENT_OBJECT_MISSING",
    );
    await request(app.getHttpServer())
      .get(`/documents/${p.document.id}/download-url`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);
  });
  it.each(["size", "type", "checksum", "signature"])(
    "rejects %s mismatch using actual S3 bytes",
    async (kind) => {
      const p = await propose(
        kind === "checksum" ? { checksumSha256: "a".repeat(64) } : {},
      );
      let value = body;
      let mime = "text/plain";
      if (kind === "size") value = Buffer.from("four");
      if (kind === "type") mime = "application/pdf";
      if (kind === "signature")
        value = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: p.upload.fields.key,
          ContentType: mime,
          Body: value,
        }),
      );
      await complete(p).expect(422);
      expect(
        (await db.document.findUniqueOrThrow({ where: { id: p.document.id } }))
          .status,
      ).toBe("PENDING_UPLOAD");
    },
  );
  it("enforces policy size/type/key restrictions at direct upload", async () => {
    const p = await propose();
    expect((await upload(p, Buffer.from("oversized"))).status).toBe(400);
    const changed = {
      ...p,
      upload: {
        ...p.upload,
        fields: { ...p.upload.fields, key: "users/other/attack" },
      },
    };
    expect((await upload(changed)).ok).toBe(false);
  });
  it("rejects expired completion and keeps reconciliation scheduled", async () => {
    const p = await propose();
    await upload(p);
    const useCases = new DocumentUploadUseCases(
      app.get(DOCUMENT_REPOSITORY),
      app.get(DOCUMENT_UPLOAD_REPOSITORY),
      app.get(DOCUMENT_STORAGE),
      {
        allowedExtensions: ["txt"],
        maxFileBytes: 64,
        maxDocuments: 2,
        maxStorageBytes: 128,
        uploadExpirySeconds: 60,
        downloadExpirySeconds: 60,
        bucket,
      },
      () => new Date(Date.now() + 61000),
    );
    await expect(
      useCases.complete(userId, p.document.id),
    ).rejects.toMatchObject({ code: "DOCUMENT_UPLOAD_EXPIRED" });
    expect(
      await db.documentCleanupTask.findUnique({
        where: { documentId: p.document.id },
      }),
    ).not.toBeNull();
  });
  it("rejects actual expired POST policies", async () => {
    const adapter = new S3DocumentStorage({
      endpoint,
      publicEndpoint: endpoint,
      region: "ap-southeast-1",
      accessKeyId: "test",
      secretAccessKey: "test",
      timeoutMs: 5000,
      maxAttempts: 1,
    });
    try {
      const auth = await adapter.authorizeUpload(
        { bucket, key: "expired-test" },
        "text/plain",
        body.length,
        new Date(Date.now() + 1500),
      );
      await new Promise((resolve) => setTimeout(resolve, 1600));
      expect(
        (await upload({ document: { id: randomUUID() }, upload: auth })).ok,
      ).toBe(false);
    } finally {
      adapter.onModuleDestroy();
    }
  });
  it("refuses upload authorization when versioning is suspended", async () => {
    await s3.send(
      new PutBucketVersioningCommand({
        Bucket: bucket,
        VersioningConfiguration: { Status: "Suspended" },
      }),
    );
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await request(app.getHttpServer())
          .post("/documents/upload-url")
          .set("Authorization", `Bearer ${token}`)
          .send({ filename: "a.txt", mimeType: "text/plain", sizeBytes: 6 })
          .expect(503);
        expect(response.body.code).toBe("DOCUMENT_BUCKET_UNSAFE");
      }
      expect(
        await db.document.count({ where: { userId, deletedAt: null } }),
      ).toBe(0);
    } finally {
      await s3.send(
        new PutBucketVersioningCommand({
          Bucket: bucket,
          VersioningConfiguration: { Status: "Enabled" },
        }),
      );
    }
  });
  it("enforces byte quota independently of document count", async () => {
    const useCases = new DocumentUploadUseCases(
      app.get(DOCUMENT_REPOSITORY),
      app.get(DOCUMENT_UPLOAD_REPOSITORY),
      app.get(DOCUMENT_STORAGE),
      {
        allowedExtensions: ["txt"],
        maxFileBytes: 64,
        maxDocuments: 10,
        maxStorageBytes: 10,
        uploadExpirySeconds: 60,
        downloadExpirySeconds: 60,
        bucket,
      },
    );
    await useCases.uploadUrl(userId, {
      filename: "a.txt",
      mimeType: "text/plain",
      sizeBytes: 6,
    });
    await expect(
      useCases.uploadUrl(userId, {
        filename: "b.txt",
        mimeType: "text/plain",
        sizeBytes: 6,
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_QUOTA_EXCEEDED" });
  });
  it("rejects invalid PDF signatures and unsafe bucket public access configuration", async () => {
    const p = await propose({
      filename: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 8,
    });
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: p.upload.fields.key,
        ContentType: "application/pdf",
        Body: Buffer.from("hello!!!"),
      }),
    );
    expect((await complete(p).expect(422)).body.code).toBe(
      "DOCUMENT_SIGNATURE_INVALID",
    );
    // High bits must not be stripped into a false valid ASCII signature.
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: p.upload.fields.key,
        ContentType: "application/pdf",
        Body: Buffer.from("%PDF-1.7").map((byte) => byte | 0x80),
      }),
    );
    expect((await complete(p).expect(422)).body.code).toBe(
      "DOCUMENT_SIGNATURE_INVALID",
    );
    await s3.send(
      new PutPublicAccessBlockCommand({
        Bucket: bucket,
        PublicAccessBlockConfiguration: { BlockPublicAcls: false },
      }),
    );
    try {
      const response = await request(app.getHttpServer())
        .post("/documents/upload-url")
        .set("Authorization", `Bearer ${token}`)
        .send({ filename: "b.txt", mimeType: "text/plain", sizeBytes: 6 })
        .expect(503);
      expect(response.body.code).toBe("DOCUMENT_BUCKET_UNSAFE");
    } finally {
      await s3.send(
        new PutPublicAccessBlockCommand({
          Bucket: bucket,
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            IgnorePublicAcls: true,
            BlockPublicPolicy: true,
            RestrictPublicBuckets: true,
          },
        }),
      );
    }
  });
  it("serializes completion versus deletion without resurrecting the document", async () => {
    const p = await propose();
    await upload(p);
    const [completion, deletion] = await Promise.all([
      complete(p),
      request(app.getHttpServer())
        .delete(`/documents/${p.document.id}`)
        .set("Authorization", `Bearer ${token}`),
    ]);
    expect([200, 404]).toContain(completion.status);
    expect(deletion.status).toBe(204);
    expect(
      (await db.document.findUniqueOrThrow({ where: { id: p.document.id } }))
        .status,
    ).toBe("DELETED");
    await request(app.getHttpServer())
      .get(`/documents/${p.document.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });
  it("enforces owner on metadata, completion, download and deletion", async () => {
    const p = await propose();
    await upload(p);
    await complete(p, otherToken).expect(404);
    for (const path of [
      `/documents/${p.document.id}`,
      `/documents/${p.document.id}/download-url`,
    ])
      await request(app.getHttpServer())
        .get(path)
        .set("Authorization", `Bearer ${otherToken}`)
        .expect(404);
    await request(app.getHttpServer())
      .delete(`/documents/${p.document.id}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .expect(404);
    expect(
      (
        await request(app.getHttpServer())
          .get("/documents")
          .set("Authorization", `Bearer ${otherToken}`)
          .expect(200)
      ).body,
    ).toEqual([]);
    await complete(p).expect(200);
    await request(app.getHttpServer())
      .delete(`/documents/${p.document.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
    await complete(p).expect(404);
    await request(app.getHttpServer())
      .get(`/documents/${p.document.id}/download-url`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
    expect(
      (
        await db.documentCleanupTask.findUniqueOrThrow({
          where: { documentId: p.document.id },
        })
      ).nextAttemptAt.getTime(),
    ).toBeGreaterThanOrEqual(
      (
        await db.document.findUniqueOrThrow({ where: { id: p.document.id } })
      ).uploadExpiresAt!.getTime(),
    );
  });
  it("serializes quota reservations and rejects injected owner or invalid filename", async () => {
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        request(app.getHttpServer())
          .post("/documents/upload-url")
          .set("Authorization", `Bearer ${token}`)
          .send({ filename: "a.txt", mimeType: "text/plain", sizeBytes: 6 }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 409]);
    await request(app.getHttpServer())
      .post("/documents/upload-url")
      .set("Authorization", `Bearer ${token}`)
      .send({
        filename: "a.txt",
        mimeType: "text/plain",
        sizeBytes: 6,
        userId: otherId,
      })
      .expect(400);
    for (const filename of ["../a.txt", "a\u0000.txt", "\ud800.txt"]) {
      await request(app.getHttpServer())
        .post("/documents/upload-url")
        .set("Authorization", `Bearer ${token}`)
        .send({ filename, mimeType: "text/plain", sizeBytes: 6 })
        .expect(400);
    }
    await request(app.getHttpServer()).get("/documents").expect(401);
  });
  it.each(["issuer", "audience", "subject", "refresh", "session"])(
    "rejects an invalid JWT %s before accessing storage",
    async (kind) => {
      const invalid = await app.get(JwtService).signAsync(
        {
          sub: kind === "subject" ? "not-a-uuid" : userId,
          sessionId: kind === "session" ? 12 : "storage",
          tokenType: kind === "refresh" ? "refresh" : "access",
        },
        {
          secret: process.env.JWT_ACCESS_SECRET,
          issuer: kind === "issuer" ? "untrusted" : process.env.JWT_ISSUER,
          audience:
            kind === "audience" ? "untrusted" : process.env.JWT_AUDIENCE,
        },
      );
      await request(app.getHttpServer())
        .get("/documents")
        .set("Authorization", `Bearer ${invalid}`)
        .expect(401);
    },
  );
});
