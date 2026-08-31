import { PrismaService } from "../src/prisma.service";
import { PrismaConversationRepository } from "../src/persistence/ai.persistence";
import { Conversation } from "../src/modules/ai/domain/entities/conversation.entity";
const db = new PrismaService();
const id = "10000000-0000-4000-8000-000000000003";
describe("AI persistence", () => {
  const repo = new PrismaConversationRepository(db);
  beforeAll(() => db.$connect());
  afterAll(async () => {
    await db.conversation.deleteMany({ where: { id } });
    await db.$disconnect();
  });
  it("round-trips Conversation", async () => {
    await repo.save(
      Conversation.create({
        id,
        userId: "00000000-0000-4000-8000-000000000001",
        title: "Integration",
      }),
    );
    expect((await repo.findById(id))?.state.title).toBe("Integration");
  });
});
