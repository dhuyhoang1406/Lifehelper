import { type INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma.service";

describe("Productivity service integration (PostgreSQL)", () => {
  const userA = "71000000-0000-4000-8000-000000000001";
  const userB = "71000000-0000-4000-8000-000000000002";
  let app: INestApplication;
  let db: PrismaService;
  let tokenA: string;
  let tokenB: string;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const tokenFor = (userId: string) =>
    new JwtService().sign(
      { sub: userId, sessionId: `session-${userId}`, tokenType: "access" },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
      },
    );
  const clean = async () => {
    await db.reminder.deleteMany({ where: { userId: { in: [userA, userB] } } });
    await db.habitLog.deleteMany({ where: { userId: { in: [userA, userB] } } });
    await db.habit.deleteMany({ where: { userId: { in: [userA, userB] } } });
    await db.calendarEvent.deleteMany({
      where: { userId: { in: [userA, userB] } },
    });
    await db.tag.deleteMany({ where: { userId: { in: [userA, userB] } } });
    await db.task.deleteMany({ where: { userId: { in: [userA, userB] } } });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    db = app.get(PrismaService);
    tokenA = tokenFor(userA);
    tokenB = tokenFor(userB);
  });
  beforeEach(() => clean());
  afterAll(async () => {
    if (db) await clean();
    await app?.close();
  });

  it("completes the task, subtask, and tag flow", async () => {
    const task = await request(app.getHttpServer())
      .post("/tasks")
      .set(auth(tokenA))
      .send({ title: "Integration searchable task", priority: "HIGH" })
      .expect(201);
    const subtask = await request(app.getHttpServer())
      .post(`/tasks/${task.body.id}/subtasks`)
      .set(auth(tokenA))
      .send({ title: "First step", position: 0 })
      .expect(201);
    const tag = await request(app.getHttpServer())
      .post("/tags")
      .set(auth(tokenA))
      .send({ name: "Integration" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/tasks/${task.body.id}/tags/${tag.body.id}`)
      .set(auth(tokenA))
      .expect(204);
    await request(app.getHttpServer())
      .patch(`/tasks/${task.body.id}/subtasks/${subtask.body.id}`)
      .set(auth(tokenA))
      .send({ completed: true })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/tasks/${task.body.id}/complete`)
      .set(auth(tokenA))
      .expect(201);

    const filtered = await request(app.getHttpServer())
      .get("/tasks")
      .set(auth(tokenA))
      .query({
        status: "COMPLETED",
        priority: "HIGH",
        tag: "integration",
        search: "searchable",
        page: 1,
        limit: 1,
      })
      .expect(200);
    expect(filtered.body).toMatchObject({ total: 1, page: 1, limit: 1 });
    expect(filtered.body.items[0].id).toBe(task.body.id);
    const persisted = await db.task.findUnique({
      where: { id: task.body.id },
      include: { subtasks: true, taskTags: true },
    });
    expect(persisted?.status).toBe("COMPLETED");
    expect(persisted?.subtasks[0].isCompleted).toBe(true);
    expect(persisted?.taskTags).toHaveLength(1);
  });

  it("persists every resource and isolates User A from User B", async () => {
    const taskA = await request(app.getHttpServer())
      .post("/tasks")
      .set(auth(tokenA))
      .send({ title: "User A task" })
      .expect(201);
    const taskB = await request(app.getHttpServer())
      .post("/tasks")
      .set(auth(tokenB))
      .send({ title: "User B task" })
      .expect(201);
    const eventA = await request(app.getHttpServer())
      .post("/calendar-events")
      .set(auth(tokenA))
      .send({
        title: "User A event",
        eventType: "WORK",
        startAt: "2026-09-23T01:00:00Z",
        endAt: "2026-09-23T02:00:00Z",
        timezone: "Asia/Ho_Chi_Minh",
      })
      .expect(201);
    const habitA = await request(app.getHttpServer())
      .post("/habits")
      .set(auth(tokenA))
      .send({
        name: "User A habit",
        frequencyType: "DAILY",
        timezone: "Asia/Ho_Chi_Minh",
        startDate: "2026-09-01",
      })
      .expect(201);
    const logA = await request(app.getHttpServer())
      .post(`/habits/${habitA.body.id}/logs`)
      .set(auth(tokenA))
      .send({ logDate: "2026-09-23" })
      .expect(201);
    const reminderA = await request(app.getHttpServer())
      .post("/reminders")
      .set(auth(tokenA))
      .send({
        resourceType: "TASK",
        resourceId: taskA.body.id,
        title: "User A reminder",
        remindAt: "2026-09-23T00:30:00Z",
        timezone: "Asia/Ho_Chi_Minh",
      })
      .expect(201);

    for (const path of [
      `/tasks/${taskA.body.id}`,
      `/calendar-events/${eventA.body.id}`,
      `/habits/${habitA.body.id}`,
      `/reminders/${reminderA.body.id}`,
    ])
      await request(app.getHttpServer())
        .get(path)
        .set(auth(tokenB))
        .expect(404);
    await request(app.getHttpServer())
      .get(`/habits/${habitA.body.id}/logs`)
      .set(auth(tokenB))
      .expect(404);
    await request(app.getHttpServer())
      .post("/reminders")
      .set(auth(tokenB))
      .send({
        resourceType: "TASK",
        resourceId: taskA.body.id,
        title: "Cross-owner reminder",
        remindAt: "2026-09-23T00:30:00Z",
        timezone: "UTC",
      })
      .expect(404);

    const tasks = await request(app.getHttpServer())
      .get("/tasks")
      .set(auth(tokenA))
      .query({ page: 1, limit: 20 })
      .expect(200);
    const events = await request(app.getHttpServer())
      .get("/calendar-events")
      .set(auth(tokenA))
      .query({
        from: "2026-09-23T00:00:00Z",
        to: "2026-09-24T00:00:00Z",
        page: 1,
        limit: 20,
      })
      .expect(200);
    const habits = await request(app.getHttpServer())
      .get("/habits")
      .set(auth(tokenA))
      .query({ page: 1, limit: 20 })
      .expect(200);
    const logs = await request(app.getHttpServer())
      .get(`/habits/${habitA.body.id}/logs`)
      .set(auth(tokenA))
      .query({ page: 1, limit: 20 })
      .expect(200);
    const reminders = await request(app.getHttpServer())
      .get("/reminders")
      .set(auth(tokenA))
      .query({ page: 1, limit: 20 })
      .expect(200);
    expect(tasks.body.items.map((item: { id: string }) => item.id)).toContain(
      taskA.body.id,
    );
    expect(
      tasks.body.items.map((item: { id: string }) => item.id),
    ).not.toContain(taskB.body.id);
    expect(events.body.map((item: { id: string }) => item.id)).toEqual([
      eventA.body.id,
    ]);
    expect(habits.body.items.map((item: { id: string }) => item.id)).toEqual([
      habitA.body.id,
    ]);
    expect(logs.body.items.map((item: { id: string }) => item.id)).toEqual([
      logA.body.id,
    ]);
    expect(reminders.body.items.map((item: { id: string }) => item.id)).toEqual(
      [reminderA.body.id],
    );
  });
});
