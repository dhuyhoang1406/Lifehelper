// Opt-in integration evaluation. Build first; use a migrated dedicated *_test database.
require("reflect-metadata");
process.env.DOCUMENT_WORKER_ENABLED = "false";
process.env.DOCUMENT_S3_BUCKET = "lifehelper-embedding-smoke-" + process.pid;
const fs = require("node:fs");
const crypto = require("node:crypto");
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("../dist/app.module");
const { PrismaService } = require("../dist/prisma.service");
const {
  DocumentUploadUseCases,
} = require("../dist/modules/document/application/use-cases/document-upload.use-cases");
const {
  DocumentJobProcessor,
} = require("../dist/modules/document/application/services/document-job-processor");
const {
  DOCUMENT_PROCESSING_REPOSITORY,
} = require("../dist/modules/document/application/ports/document-processing.port");
const {
  EMBEDDING_PROVIDER,
} = require("../dist/modules/document/application/ports/embedding-provider.port");
const {
  PrismaDocumentVectorIndex,
} = require("../dist/persistence/document-vector-index");
const {
  S3Client,
  CreateBucketCommand,
  PutBucketVersioningCommand,
  PutPublicAccessBlockCommand,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
  DeleteBucketCommand,
} = require("@aws-sdk/client-s3");
async function main() {
  if (process.env.EMBEDDING_PROVIDER !== "ollama")
    throw new Error("Real Ollama required");
  if (!/_test$/.test(new URL(process.env.DATABASE_URL).pathname))
    throw new Error("Dedicated *_test database required");
  if (
    !["localhost", "127.0.0.1"].includes(
      new URL(process.env.AWS_ENDPOINT_URL).hostname,
    ) ||
    !["localhost", "127.0.0.1"].includes(
      new URL(process.env.DOCUMENT_S3_PUBLIC_ENDPOINT).hostname,
    )
  )
    throw new Error("Local test storage endpoints required");
  const fixtures = JSON.parse(
    fs.readFileSync(__dirname + "/fixtures/vietnamese-retrieval.json", "utf8"),
  );
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const db = app.get(PrismaService),
    jobs = app.get(DOCUMENT_PROCESSING_REPOSITORY),
    processor = app.get(DocumentJobProcessor);
  const provider = app.get(EMBEDDING_PROVIDER),
    uploads = app.get(DocumentUploadUseCases),
    index = new PrismaDocumentVectorIndex(db);
  const s3 = new S3Client({
    endpoint: process.env.AWS_ENDPOINT_URL,
    region: process.env.AWS_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  const bucket = process.env.DOCUMENT_S3_BUCKET,
    user = crypto.randomUUID(),
    map = new Map(),
    ids = [];
  let created = false;
  try {
    await s3.send(
      new CreateBucketCommand({
        Bucket: bucket,
        CreateBucketConfiguration: {
          LocationConstraint: process.env.AWS_REGION,
        },
      }),
    );
    created = true;
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
    for (const fixture of fixtures.documents) {
      const bytes = Buffer.from(fixture.text),
        proposal = await uploads.uploadUrl(user, {
          filename: fixture.id + ".txt",
          mimeType: "text/plain",
          sizeBytes: bytes.length,
          checksumSha256: crypto
            .createHash("sha256")
            .update(bytes)
            .digest("hex"),
        });
      ids.push(proposal.document.id);
      map.set(proposal.document.id, fixture.id);
      const form = new FormData();
      for (const [k, v] of Object.entries(proposal.upload.fields))
        form.append(k, v);
      form.append("file", new Blob([bytes]), fixture.id + ".txt");
      const uploaded = await fetch(proposal.upload.url, {
        method: "POST",
        body: form,
      });
      if (uploaded.status !== 204)
        throw new Error("Upload failed: " + uploaded.status);
      await uploads.complete(user, proposal.document.id);
      for (let step = 0; step < 2; step++) {
        const lease = await jobs.claim("embedding-smoke");
        if (!lease || lease.documentId !== proposal.document.id)
          throw new Error("Unexpected claim");
        await processor.run(lease, new AbortController().signal);
      }
      const row = await db.document.findUniqueOrThrow({
        where: { id: proposal.document.id },
      });
      if (row.status !== "READY")
        throw new Error("Indexing failed: " + row.processingError);
    }
    const space = {
      model: process.env.EMBEDDING_MODEL,
      version: process.env.EMBEDDING_MODEL_VERSION,
      dimensions: Number(process.env.EMBEDDING_DIMENSIONS),
    };
    const result = await provider.embed(
      {
        space,
        items: fixtures.queries.map((q, i) => ({
          id: String(i),
          text: q.text,
        })),
      },
      new AbortController().signal,
    );
    for (let i = 0; i < fixtures.queries.length; i++) {
      const single = await provider.embed(
        { space, items: [{ id: String(i), text: fixtures.queries[i].text }] },
        new AbortController().signal,
      );
      const a = result.items[i].vector,
        b = single.items[0].vector;
      const cosine =
        a.reduce((sum, v, j) => sum + v * b[j], 0) /
        (Math.hypot(...a) * Math.hypot(...b));
      if (cosine < 0.9999) throw new Error("Batch/single input order mismatch");
    }
    const cases = [];
    for (let i = 0; i < fixtures.queries.length; i++) {
      const matches = await index.search({
        userId: user,
        space,
        vector: result.items[i].vector,
        topK: 3,
      });
      const actual = map.get(matches[0]?.documentId),
        expected = fixtures.queries[i].expected;
      cases.push({
        expected,
        actual,
        pass: actual === expected,
        top1Cosine: 1 - matches[0].distance,
      });
    }
    const report = {
      space,
      documents: fixtures.documents.length,
      queries: cases.length,
      batchOrderVerified: true,
      top1Correct: cases.filter((c) => c.pass).length,
      cases,
    };
    console.log(JSON.stringify(report, null, 2));
    if (report.top1Correct !== cases.length) process.exitCode = 1;
  } finally {
    await db.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } });
    await db.document.deleteMany({ where: { id: { in: ids } } });
    if (created) {
      const versions = await s3.send(
        new ListObjectVersionsCommand({ Bucket: bucket }),
      );
      const objects = [
        ...(versions.Versions || []),
        ...(versions.DeleteMarkers || []),
      ].map((o) => ({ Key: o.Key, VersionId: o.VersionId }));
      if (objects.length)
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: objects },
          }),
        );
      await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
    }
    s3.destroy();
    await app.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
