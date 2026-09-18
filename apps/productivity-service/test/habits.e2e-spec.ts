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
  HABIT_LOG_REPOSITORY,
  HABIT_REPOSITORY,
  type HabitLogRepository,
  type HabitRepository,
} from "../src/application/repositories/productivity.repositories";
import type { AuthenticatedRequest } from "../src/auth/jwt-auth.guard";
import { JwtAuthGuard } from "../src/auth/jwt-auth.guard";
import type { Habit } from "../src/modules/habit/domain/entities/habit.entity";
import type { HabitLog } from "../src/modules/habit/domain/entities/habit-log.entity";
import type { HabitSchedule } from "../src/modules/habit/domain/entities/habit-schedule.entity";
import { DuplicateHabitLogError } from "../src/modules/habit/domain/errors/habit-domain.error";
import { PrismaService } from "../src/prisma.service";

class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.auth = {
      userId:
        (request.headers["x-test-user-id"] as string | undefined) ??
        "00000000-0000-4000-8000-000000000001",
      sessionId: "test-session",
    };
    return true;
  }
}

describe("Habit endpoints (e2e)", () => {
  let app: INestApplication;
  const habits = new Map<
    string,
    { habit: Habit; schedules: HabitSchedule[] }
  >();
  const logs = new Map<string, HabitLog>();
  const habitRepository: HabitRepository = {
    async findByIdAndUserId(id, userId) {
      const aggregate = habits.get(id);
      return aggregate?.habit.state.userId === userId &&
        !aggregate.habit.state.deletedAt
        ? aggregate
        : null;
    },
    async findPageByUserId(userId, query) {
      const all = [...habits.values()]
        .map(({ habit }) => habit)
        .filter(
          ({ state }) =>
            state.userId === userId &&
            !state.deletedAt &&
            (query.active === undefined || state.isActive === query.active),
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
    async save(habit, schedules) {
      habits.set(habit.state.id, {
        habit,
        schedules: schedules ?? habits.get(habit.state.id)?.schedules ?? [],
      });
    },
  };
  const logRepository: HabitLogRepository = {
    async findByIdAndHabitId(id, habitId) {
      const log = logs.get(id);
      return log?.state.habitId === habitId ? log : null;
    },
    async findPageByHabitId(habitId, query) {
      const all = [...logs.values()].filter(
        ({ state }) =>
          state.habitId === habitId &&
          (!query.from || state.logDate >= query.from) &&
          (!query.to || state.logDate <= query.to),
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
    async save(log) {
      const duplicate = [...logs.values()].some(
        ({ state }) =>
          state.id !== log.state.id &&
          state.habitId === log.state.habitId &&
          state.logDate === log.state.logDate,
      );
      if (duplicate) throw new DuplicateHabitLogError();
      logs.set(log.state.id, log);
    },
  };

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ isHealthy: jest.fn().mockResolvedValue(true) })
      .overrideProvider(HABIT_REPOSITORY)
      .useValue(habitRepository)
      .overrideProvider(HABIT_LOG_REPOSITORY)
      .useValue(logRepository)
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
  beforeEach(() => {
    habits.clear();
    logs.clear();
  });

  const createWeeklyHabit = () =>
    request(app.getHttpServer()).post("/habits").send({
      name: "Run",
      frequencyType: "WEEKLY",
      timezone: "Asia/Ho_Chi_Minh",
      startDate: "2026-09-01",
      schedules: [{ dayOfWeek: 2, timeOfDay: "06:30" }],
    });

  it("creates, updates, pauses, resumes, and archives a habit", async () => {
    const created = await createWeeklyHabit().expect(201);
    expect(created.body).toMatchObject({
      timezone: "Asia/Ho_Chi_Minh",
      isActive: true,
    });
    expect(created.body.schedules).toHaveLength(1);
    const id = created.body.id as string;
    await request(app.getHttpServer())
      .get("/habits")
      .query({ active: true, page: 1, limit: 20 })
      .expect(200)
      .expect(({ body }) => {
        expect(body.total).toBe(1);
        expect(body.items[0].id).toBe(id);
      });
    await request(app.getHttpServer())
      .patch(`/habits/${id}`)
      .send({ targetCount: 2 })
      .expect(200)
      .expect(({ body }) => expect(body.targetCount).toBe(2));
    await request(app.getHttpServer())
      .post(`/habits/${id}/pause`)
      .expect(201)
      .expect(({ body }) => expect(body.isActive).toBe(false));
    await request(app.getHttpServer())
      .post(`/habits/${id}/resume`)
      .expect(201)
      .expect(({ body }) => expect(body.isActive).toBe(true));
    await request(app.getHttpServer()).delete(`/habits/${id}`).expect(204);
    await request(app.getHttpServer()).get(`/habits/${id}`).expect(404);
  });

  it("logs once per local date, queries logs, and updates a log", async () => {
    const created = await createWeeklyHabit().expect(201);
    const id = created.body.id as string;
    const logged = await request(app.getHttpServer())
      .post(`/habits/${id}/logs`)
      .send({
        logDate: "2026-09-15",
        completedCount: 1,
        completedAt: "2026-09-14T23:30:00Z",
      })
      .expect(201);
    expect(logged.body.logDate).toBe("2026-09-15");
    await request(app.getHttpServer())
      .post(`/habits/${id}/logs`)
      .send({ logDate: "2026-09-15" })
      .expect(409);
    await request(app.getHttpServer())
      .get(`/habits/${id}/logs`)
      .query({ from: "2026-09-01", to: "2026-09-30" })
      .expect(200)
      .expect(({ body }) => expect(body.total).toBe(1));
    await request(app.getHttpServer())
      .patch(`/habits/${id}/logs/${logged.body.id}`)
      .send({ completedCount: 3 })
      .expect(200)
      .expect(({ body }) => expect(body.completedCount).toBe(3));
  });

  it("enforces schedule rules, timezone validation, and ownership", async () => {
    await request(app.getHttpServer())
      .post("/habits")
      .send({
        name: "Invalid daily",
        frequencyType: "DAILY",
        timezone: "Invalid/Zone",
        startDate: "2026-09-01",
        schedules: [{ dayOfWeek: 2, timeOfDay: "06:30" }],
      })
      .expect(400);
    const created = await createWeeklyHabit().expect(201);
    await request(app.getHttpServer())
      .get(`/habits/${created.body.id}`)
      .set("x-test-user-id", "00000000-0000-4000-8000-000000000002")
      .expect(404);
  });
});
