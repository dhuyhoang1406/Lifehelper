import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import {
  S3Client,
  CreateBucketCommand,
  PutBucketVersioningCommand,
  PutPublicAccessBlockCommand,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
  DeleteBucketCommand,
} from "@aws-sdk/client-s3";
import { PrismaService } from "../src/prisma.service";
import {
  EMBEDDING_PROVIDER,
  type EmbeddingRequest,
} from "../src/modules/document/application/ports/embedding-provider.port";
import { DocumentUploadUseCases } from "../src/modules/document/application/use-cases/document-upload.use-cases";
import { DOCUMENT_PROCESSING_REPOSITORY } from "../src/modules/document/application/ports/document-processing.port";
import { DocumentJobProcessor } from "../src/modules/document/application/services/document-job-processor";
async function main() {
  const userId = process.env.AI_WORKFLOW_USER_ID;
  if (
    process.env.NODE_ENV !== "test" ||
    !userId ||
    !/_test$|_ci$/.test(new URL(process.env.DATABASE_URL!).pathname)
  )
    throw new Error("Dedicated test database required");
  const bucket = "lifehelper-rag-workflow-" + randomUUID();
  process.env.DOCUMENT_S3_BUCKET = bucket;
  const s3 = new S3Client({
    endpoint: process.env.AWS_ENDPOINT_URL,
    region: process.env.AWS_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
  const { AppModule } = await import("../src/app.module");
  const ref = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EMBEDDING_PROVIDER)
    .useValue({
      embed: async (r: EmbeddingRequest) => ({
        space: r.space,
        items: r.items.map((i) => ({ id: i.id, vector: [1, 0] })),
      }),
    })
    .compile();
  const app = ref.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const db = app.get(PrismaService);
  let bucketCreated = false,
    closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    try {
      const docs = await db.document.findMany({
        where: { userId },
        select: { id: true },
      });
      await db.outboxEvent.deleteMany({
        where: { aggregateId: { in: docs.map((d) => d.id) } },
      });
      await db.document.deleteMany({ where: { userId } });
      if (bucketCreated) {
        const list = await s3.send(
          new ListObjectVersionsCommand({ Bucket: bucket }),
        );
        const objects = [
          ...(list.Versions ?? []),
          ...(list.DeleteMarkers ?? []),
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
    } finally {
      s3.destroy();
      await app.close();
      process.disconnect?.();
    }
  };
  process.on("message", (message) => {
    if ((message as { type: string }).type === "shutdown") void close();
  });
  process.on("disconnect", () => void close());
  try {
    await app.listen(0, "127.0.0.1");
    await s3.send(
      new CreateBucketCommand({
        Bucket: bucket,
        CreateBucketConfiguration: {
          LocationConstraint: process.env.AWS_REGION,
        },
      }),
    );
    bucketCreated = true;
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
    const text = "Nhân viên có 12 ngày phép năm.",
      uploads = app.get(DocumentUploadUseCases);
    const proposal = await uploads.uploadUrl(userId, {
      filename: "annual-leave.txt",
      mimeType: "text/plain",
      sizeBytes: Buffer.byteLength(text),
    });
    const form = new FormData();
    for (const [key, value] of Object.entries(proposal.upload.fields))
      form.append(key, value);
    form.append("file", new Blob([text]), "annual-leave.txt");
    if (
      (await fetch(proposal.upload.url, { method: "POST", body: form }))
        .status !== 204
    )
      throw new Error("Fixture upload failed");
    await uploads.complete(userId, proposal.document.id);
    const jobs = app.get(DOCUMENT_PROCESSING_REPOSITORY),
      processor = app.get(DocumentJobProcessor);
    for (let stage = 0; stage < 2; stage++) {
      const lease = await jobs.claim("rag-workflow");
      if (!lease) throw new Error("Missing processing job");
      await processor.run(lease, new AbortController().signal);
    }
    const d = await uploads.get(userId, proposal.document.id);
    if (d.status !== "READY") throw new Error("Fixture indexing failed");
    process.send?.({
      type: "ready",
      url: await app.getUrl(),
      documentId: proposal.document.id,
    });
  } catch (error) {
    await close();
    throw error;
  }
}
void main().catch(() => {
  process.send?.({ type: "error" });
  process.exitCode = 1;
  process.disconnect?.();
});
