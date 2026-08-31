import { DEMO_IDS } from "@lifehelper/shared-types";
import { DocumentStatus, PrismaClient } from "../generated/client";
const db = new PrismaClient();
async function main() {
  const now = new Date("2026-01-01T00:00:00Z");
  await db.document.upsert({
    where: { id: DEMO_IDS.document },
    update: {},
    create: {
      id: DEMO_IDS.document,
      userId: DEMO_IDS.user,
      originalFilename: "demo.txt",
      storageFilename: "demo.txt",
      mimeType: "text/plain",
      sizeBytes: 0n,
      s3Bucket: "lifehelper-local",
      s3Key: `users/${DEMO_IDS.user}/documents/${DEMO_IDS.document}/demo.txt`,
      status: DocumentStatus.PENDING_UPLOAD,
      createdAt: now,
      updatedAt: now,
    },
  });
}
main().finally(() => db.$disconnect());
