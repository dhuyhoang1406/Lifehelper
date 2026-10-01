import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { isUUID } from "class-validator";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma.service";

async function main() {
  const userId = process.env.AI_WORKFLOW_USER_ID;
  if (process.env.NODE_ENV !== "test" || !userId || !isUUID(userId))
    throw new Error("Workflow server requires a synthetic test user");
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.use(
    (
      req: { method: string; path: string; headers: Record<string, unknown> },
      _res: unknown,
      next: () => void,
    ) => {
      process.send?.({
        type: "trace",
        method: req.method,
        path: req.path,
        correlationId: req.headers["x-correlation-id"],
      });
      next();
    },
  );
  await app.listen(0, "127.0.0.1");
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    const db = app.get(PrismaService);
    const [tasks, events] = await Promise.all([
      db.task.findMany({ where: { userId }, select: { id: true } }),
      db.calendarEvent.findMany({ where: { userId }, select: { id: true } }),
    ]);
    await db.outboxEvent.deleteMany({
      where: {
        aggregateId: { in: [...tasks, ...events].map((row) => row.id) },
      },
    });
    await db.task.deleteMany({ where: { userId } });
    await db.calendarEvent.deleteMany({ where: { userId } });
    await app.close();
    process.disconnect?.();
  }
  process.on("message", (message) => {
    if ((message as { type?: string }).type === "shutdown") void close();
  });
  process.on("disconnect", () => {
    void close();
  });
  process.send?.({ type: "ready", url: await app.getUrl() });
}
void main().catch(() => {
  process.send?.({
    type: "error",
    message:
      "Productivity workflow server startup failed; check test database and environment",
  });
  process.exitCode = 1;
  process.disconnect?.();
});
