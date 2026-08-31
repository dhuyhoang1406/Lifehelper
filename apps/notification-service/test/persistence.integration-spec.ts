import { PrismaService } from "../src/prisma.service";
import { PrismaNotificationRepository } from "../src/persistence/notification.persistence";
import { Notification } from "../src/modules/notification/domain/entities/notification.entity";
import { NotificationType } from "../src/modules/notification/domain/enums/notification.enums";
const db = new PrismaService();
const id = "10000000-0000-4000-8000-000000000005";
describe("Notification persistence", () => {
  const repo = new PrismaNotificationRepository(db);
  beforeAll(() => db.$connect());
  afterAll(async () => {
    await db.notification.deleteMany({ where: { id } });
    await db.$disconnect();
  });
  it("round-trips Notification JSON", async () => {
    await repo.save(
      Notification.create({
        id,
        userId: "00000000-0000-4000-8000-000000000001",
        type: NotificationType.SYSTEM,
        title: "Integration",
        body: "Body",
        data: { key: "value" },
      }),
    );
    expect((await repo.findById(id))?.state.data).toEqual({ key: "value" });
  });
});
