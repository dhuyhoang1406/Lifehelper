import {
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { CALENDAR_EVENT_REPOSITORY } from "../src/application/repositories/productivity.repositories";
import type { CalendarEventRepository } from "../src/application/repositories/productivity.repositories";
import type { AuthenticatedRequest } from "../src/auth/jwt-auth.guard";
import { JwtAuthGuard } from "../src/auth/jwt-auth.guard";
import type { CalendarEvent } from "../src/modules/calendar/domain/entities/calendar-event.entity";
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

describe("Calendar event endpoints (e2e)", () => {
  let app: INestApplication;
  const records = new Map<string, CalendarEvent>();
  const repository: CalendarEventRepository = {
    async findByIdAndUserId(id, userId) {
      const event = records.get(id);
      return event?.state.userId === userId && !event.state.deletedAt
        ? event
        : null;
    },
    async findByUserAndRange(userId, from, to, page = 1, limit = 50) {
      return [...records.values()]
        .filter(
          ({ state }) =>
            state.userId === userId &&
            !state.deletedAt &&
            (!from || state.endAt > from) &&
            (!to || state.startAt < to),
        )
        .sort((a, b) => a.state.startAt.getTime() - b.state.startAt.getTime())
        .slice((page - 1) * limit, page * limit);
    },
    async save(event) {
      records.set(event.state.id, event);
    },
  };

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ isHealthy: jest.fn().mockResolvedValue(true) })
      .overrideProvider(CALENDAR_EVENT_REPOSITORY)
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

  it("creates, gets, updates, and deletes an owned event", async () => {
    const created = await request(app.getHttpServer())
      .post("/calendar-events")
      .send({
        title: "Team sync",
        eventType: "MEETING",
        startAt: "2026-09-16T09:00:00+07:00",
        endAt: "2026-09-16T10:00:00+07:00",
        timezone: "Asia/Ho_Chi_Minh",
      })
      .expect(201);
    expect(created.body.startAt).toBe("2026-09-16T02:00:00.000Z");
    expect(created.body.timezone).toBe("Asia/Ho_Chi_Minh");

    await request(app.getHttpServer())
      .get(`/calendar-events/${created.body.id}`)
      .expect(200)
      .expect(({ body }) => expect(body.title).toBe("Team sync"));
    await request(app.getHttpServer())
      .patch(`/calendar-events/${created.body.id}`)
      .send({ title: "Updated sync" })
      .expect(200)
      .expect(({ body }) => expect(body.title).toBe("Updated sync"));
    await request(app.getHttpServer())
      .delete(`/calendar-events/${created.body.id}`)
      .expect(204);
    await request(app.getHttpServer())
      .get(`/calendar-events/${created.body.id}`)
      .expect(404);
  });

  it("queries overlapping events by range and enforces ownership", async () => {
    const create = (title: string, startAt: string, endAt: string) =>
      request(app.getHttpServer()).post("/calendar-events").send({
        title,
        eventType: "WORK",
        startAt,
        endAt,
        timezone: "UTC",
      });
    await create(
      "Overlaps start",
      "2026-09-15T23:00:00Z",
      "2026-09-16T01:00:00Z",
    ).expect(201);
    await create(
      "Outside",
      "2026-09-17T00:00:00Z",
      "2026-09-17T01:00:00Z",
    ).expect(201);
    await request(app.getHttpServer())
      .post("/calendar-events")
      .set("x-test-user-id", "00000000-0000-4000-8000-000000000002")
      .send({
        title: "Another user's event",
        eventType: "PERSONAL",
        startAt: "2026-09-16T02:00:00Z",
        endAt: "2026-09-16T03:00:00Z",
        timezone: "Europe/Paris",
      })
      .expect(201);

    await request(app.getHttpServer())
      .get("/calendar-events")
      .query({
        from: "2026-09-16T00:00:00Z",
        to: "2026-09-17T00:00:00Z",
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
        expect(body[0].title).toBe("Overlaps start");
      });
  });

  it("rejects invalid time ranges, timezone, and half-open queries", async () => {
    const base = {
      title: "Invalid",
      eventType: "OTHER",
      startAt: "2026-09-16T02:00:00Z",
      endAt: "2026-09-16T01:00:00Z",
      timezone: "UTC",
    };
    await request(app.getHttpServer())
      .post("/calendar-events")
      .send(base)
      .expect(400);
    await request(app.getHttpServer())
      .post("/calendar-events")
      .send({
        ...base,
        endAt: "2026-09-16T03:00:00Z",
        timezone: "Invalid/Zone",
      })
      .expect(400);
    await request(app.getHttpServer())
      .get("/calendar-events")
      .query({ from: "2026-09-16T00:00:00Z" })
      .expect(400);
  });
});
