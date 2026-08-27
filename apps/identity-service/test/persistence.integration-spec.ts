import { PrismaService } from "../src/prisma.service";
import { PrismaUserRepository } from "../src/persistence/identity.repositories";
import { User } from "../src/modules/identity/domain/entities/user.entity";
const db = new PrismaService();
const id = "10000000-0000-4000-8000-000000000001";
describe("Identity persistence", () => {
  const repo = new PrismaUserRepository(db);
  beforeAll(() => db.$connect());
  afterAll(async () => {
    await db.user.deleteMany({ where: { id } });
    await db.$disconnect();
  });
  it("saves and restores a User domain entity", async () => {
    const entity = User.create({
      id,
      email: "integration@lifehelper.local",
      displayName: "Integration",
    });
    await repo.save(entity);
    expect((await repo.findByEmail(entity.state.email))?.state.id).toBe(id);
  });
});
