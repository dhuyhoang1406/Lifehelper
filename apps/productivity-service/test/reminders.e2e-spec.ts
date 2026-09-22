import {
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import {
  REMINDER_REPOSITORY,
  type ReminderRepository,
} from "../src/application/repositories/productivity.repositories";
import type { AuthenticatedRequest } from "../src/auth/jwt-auth.guard";
import { JwtAuthGuard } from "../src/auth/jwt-auth.guard";
import type { Reminder } from "../src/modules/reminder/domain/entities/reminder.entity";
import { PrismaService } from "../src/prisma.service";

class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    req.auth = {
      userId:
        (req.headers["x-test-user-id"] as string | undefined) ??
        "00000000-0000-4000-8000-000000000001",
      sessionId: "test",
    };
    return true;
  }
}
describe("Reminder endpoints (e2e)", () => {
  let app: INestApplication;
  const records = new Map<string, Reminder>();
  const repository: ReminderRepository = {
    async findPendingBefore() { return []; },
    async findByIdAndUserId(id, userId) {
      const reminder = records.get(id);
      return reminder?.state.userId === userId ? reminder : null;
    },
    async findPageByUserId(userId, query) {
      const all = [...records.values()].filter(
        ({ state }) =>
          state.userId === userId &&
          (!query.status || state.status === query.status) &&
          (!query.from || state.remindAt >= query.from) &&
          (!query.to || state.remindAt < query.to),
      );
      return {
        items: all.slice(
          (query.page - 1) * query.limit,
          query.page * query.limit,
        ),
        total: all.length,
        page: query.page,
        limit: query.limit,
      };
    },
    async save(reminder) {
      records.set(reminder.state.id, reminder);
    },
    async delete(id) {
      records.delete(id);
    },
    async resourceBelongsToUser(type, id, userId) {
      return (
        type === "TASK" &&
        id === "20000000-0000-4000-8000-000000000001" &&
        userId === "00000000-0000-4000-8000-000000000001"
      );
    },
  };
  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ isHealthy: jest.fn().mockResolvedValue(true) })
      .overrideProvider(REMINDER_REPOSITORY)
      .useValue(repository)
      .overrideGuard(JwtAuthGuard)
      .useClass(TestAuthGuard)
      .compile();
    app = ref.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => records.clear());
  const payload = {
    resourceType: "CUSTOM",
    title: "Pay bill",
    remindAt: "2026-09-22T09:00:00+07:00",
    timezone: "Asia/Ho_Chi_Minh",
  };
  it("creates, lists, updates, cancels, and deletes an owned reminder", async () => {
    const created = await request(app.getHttpServer())
      .post("/reminders")
      .send(payload)
      .expect(201);
    const id = created.body.id as string;
    expect(created.body.remindAt).toBe("2026-09-22T02:00:00.000Z");
    await request(app.getHttpServer())
      .get("/reminders")
      .query({ status: "PENDING", page: 1, limit: 20 })
      .expect(200)
      .expect(({ body }) => expect(body.total).toBe(1));
    await request(app.getHttpServer()).get(`/reminders/${id}`).expect(200);
    await request(app.getHttpServer())
      .patch(`/reminders/${id}`)
      .send({ title: "Updated" })
      .expect(200)
      .expect(({ body }) => expect(body.title).toBe("Updated"));
    await request(app.getHttpServer())
      .post(`/reminders/${id}/cancel`)
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe("CANCELLED"));
    await request(app.getHttpServer())
      .patch(`/reminders/${id}`)
      .send({ title: "Too late" })
      .expect(400);
    await request(app.getHttpServer()).delete(`/reminders/${id}`).expect(204);
    await request(app.getHttpServer()).get(`/reminders/${id}`).expect(404);
  });
  it("rejects invalid timezone, missing linked resource, and cross-owner access", async () => {
    await request(app.getHttpServer())
      .post("/reminders")
      .send({ ...payload, timezone: "Invalid/Zone" })
      .expect(400);
    await request(app.getHttpServer())
      .post("/reminders")
      .send({
        ...payload,
        resourceType: "TASK",
        resourceId: "20000000-0000-4000-8000-000000000099",
      })
      .expect(404);
    const created = await request(app.getHttpServer())
      .post("/reminders")
      .send({
        ...payload,
        resourceType: "TASK",
        resourceId: "20000000-0000-4000-8000-000000000001",
      })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/reminders/${created.body.id}`)
      .set("x-test-user-id", "00000000-0000-4000-8000-000000000002")
      .expect(404);
  });
});
