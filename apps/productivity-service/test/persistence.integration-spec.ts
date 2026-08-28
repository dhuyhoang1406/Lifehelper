import { PrismaService } from "../src/prisma.service";
import { PrismaTaskRepository } from "../src/persistence/productivity.repositories";
import { Task } from "../src/modules/task/domain/entities/task.entity";
import {
  PrismaTransactionRunner,
  writeOutbox,
} from "../src/persistence/transaction/prisma-transaction";
const db = new PrismaService();
const id = "10000000-0000-4000-8000-000000000002";
describe("Productivity persistence", () => {
  const repo = new PrismaTaskRepository(db);
  beforeAll(() => db.$connect());
  afterAll(async () => {
    await db.outboxEvent.deleteMany({ where: { aggregateId: id } });
    await db.task.deleteMany({ where: { id } });
    await db.$disconnect();
  });
  it("saves and restores Task", async () => {
    await repo.save(
      Task.create({
        id,
        userId: "00000000-0000-4000-8000-000000000001",
        title: "Integration",
      }),
    );
    expect((await repo.findById(id))?.state.title).toBe("Integration");
  });
  it("rolls back business data and outbox atomically", async () => {
    const rollbackId = "10000000-0000-4000-8000-000000000099";
    await expect(
      new PrismaTransactionRunner(db).run(async (tx) => {
        await tx.task.create({
          data: {
            id: rollbackId,
            userId: "00000000-0000-4000-8000-000000000001",
            title: "Rollback",
            status: "TODO",
            priority: "MEDIUM",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
        await writeOutbox(tx, {
          id: rollbackId,
          eventType: "task.created",
          aggregateType: "Task",
          aggregateId: rollbackId,
          payload: {},
          occurredAt: new Date(),
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await db.task.findUnique({ where: { id: rollbackId } })).toBeNull();
    expect(
      await db.outboxEvent.findUnique({ where: { id: rollbackId } }),
    ).toBeNull();
  });
});
