import { PrismaService } from "../src/prisma.service";
import { PrismaDocumentRepository } from "../src/persistence/document.persistence";
import { Document } from "../src/modules/document/domain/entities/document.entity";
const db = new PrismaService();
const id = "10000000-0000-4000-8000-000000000004";
describe("Document persistence", () => {
  const repo = new PrismaDocumentRepository(db);
  beforeAll(() => db.$connect());
  afterAll(async () => {
    await db.document.deleteMany({ where: { id } });
    await db.$disconnect();
  });
  it("round-trips Document including bigint", async () => {
    await repo.save(
      Document.create({
        id,
        userId: "00000000-0000-4000-8000-000000000001",
        originalFilename: "i.txt",
        storageFilename: "i.txt",
        mimeType: "text/plain",
        sizeBytes: 12n,
        s3Bucket: "test",
        s3Key: `integration/${id}`,
      }),
    );
    expect((await repo.findById(id))?.state.sizeBytes).toBe(12n);
  });
});
