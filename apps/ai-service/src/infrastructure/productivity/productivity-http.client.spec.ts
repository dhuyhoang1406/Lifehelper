import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { AIErrorCode } from "../../application/errors/ai.errors";
import { ProductivityHttpClient } from "./productivity-http.client";
import { validateWriteCall } from "../../application/services/ai-write-tools";
import type { AIJsonObject } from "../../application/ports/ai-provider.port";

const taskId = "00000000-0000-4000-8000-000000000001";
const writeCases: Array<{ name: string; args: AIJsonObject; method: string; path: string; body?: AIJsonObject }> = [
  { name: "create_task", args: { title: "Read" }, method: "POST", path: "/tasks", body: { title: "Read" } },
  { name: "update_task", args: { taskId, title: "Updated" }, method: "PATCH", path: "/tasks/" + taskId, body: { title: "Updated" } },
  { name: "complete_task", args: { taskId }, method: "POST", path: "/tasks/" + taskId + "/complete", body: undefined },
  { name: "create_calendar_event", args: { title: "Meeting", eventType: "MEETING", startAt: "2026-10-12T18:00:00+07:00", endAt: "2026-10-12T19:00:00+07:00", timezone: "Asia/Ho_Chi_Minh" }, method: "POST", path: "/calendar-events", body: { title: "Meeting", eventType: "MEETING", startAt: "2026-10-12T18:00:00+07:00", endAt: "2026-10-12T19:00:00+07:00", timezone: "Asia/Ho_Chi_Minh" } },
  { name: "create_reminder", args: { resourceType: "CUSTOM", title: "Call", remindAt: "2026-10-12T18:00:00+07:00", timezone: "Asia/Ho_Chi_Minh" }, method: "POST", path: "/reminders", body: { resourceType: "CUSTOM", title: "Call", remindAt: "2026-10-12T18:00:00+07:00", timezone: "Asia/Ho_Chi_Minh" } },
  { name: "create_habit", args: { name: "Walk", frequencyType: "DAILY", timezone: "Asia/Ho_Chi_Minh", startDate: "2026-10-12" }, method: "POST", path: "/habits", body: { name: "Walk", frequencyType: "DAILY", timezone: "Asia/Ho_Chi_Minh", startDate: "2026-10-12" } },
  { name: "log_habit", args: { habitId: taskId, logDate: "2026-10-12", timezone: "Asia/Ho_Chi_Minh" }, method: "POST", path: "/habits/" + taskId + "/logs", body: { logDate: "2026-10-12" } },
];

describe("Productivity HTTP read adapter", () => {
  let handler: (request: IncomingMessage, response: ServerResponse) => void;
  const server = createServer((request, response) => handler(request, response));
  let baseUrl: string;
  const context = { userId: "user-a", accessToken: "private-token", correlationId: "trace-1" };

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

  it("forwards verified bearer context and returns only task answer fields", async () => {
    handler = (request, response) => {
      expect(request.method).toBe("GET");
      expect(request.headers.authorization).toBe("Bearer private-token");
      expect(request.headers["x-correlation-id"]).toBe("trace-1");
      expect(request.url).toContain("/tasks?page=1&limit=20");
      expect(request.url).not.toContain("user-a");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ items: [{ id: "task-1", title: "Read", status: "TODO", priority: "LOW", dueAt: null, description: "private" }], total: 1, page: 1 }));
    };
    const result = await new ProductivityHttpClient(baseUrl, 1000).listTasks(context, { page: 1, limit: 20 });
    expect(result).toEqual({ items: [{ id: "task-1", title: "Read", status: "TODO", priority: "LOW", dueAt: null }], total: 1 });
  });

  it("preserves calendar range and timezone in minimized output", async () => {
    handler = (request, response) => {
      const url = new URL(request.url ?? "", baseUrl);
      expect(url.searchParams.get("from")).toBe("2026-09-28T00:00:00+07:00");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify([{ id: "event-1", title: "Meeting", eventType: "MEETING", startAt: "2026-09-28T01:00:00.000Z", endAt: "2026-09-28T02:00:00.000Z", timezone: "Asia/Ho_Chi_Minh", description: "private" }]));
    };
    const events = await new ProductivityHttpClient(baseUrl, 1000).listCalendar(context, { from: "2026-09-28T00:00:00+07:00", to: "2026-09-29T00:00:00+07:00", limit: 50 });
    expect(events[0]).not.toHaveProperty("description");
    expect(events[0]?.timezone).toBe("Asia/Ho_Chi_Minh");
  });

  it("does not expose raw upstream error bodies", async () => {
    handler = (_request, response) => { response.statusCode = 503; response.end("private stack and secret"); };
    await expect(new ProductivityHttpClient(baseUrl, 1000).listTasks(context, { page: 1, limit: 20 }))
      .rejects.toMatchObject({ code: AIErrorCode.AI_PRODUCTIVITY_UNAVAILABLE, message: "Productivity Service is unavailable" });
  });

  it("maps malformed successful payloads to a stable error", async () => {
    handler = (_request, response) => response.end(JSON.stringify({ items: [{ id: 1 }], total: 1 }));
    await expect(new ProductivityHttpClient(baseUrl, 1000).listTasks(context, { page: 1, limit: 20 }))
      .rejects.toMatchObject({ code: AIErrorCode.AI_PRODUCTIVITY_INVALID_RESPONSE });
  });

  it("bounds slow upstream calls", async () => {
    handler = () => undefined;
    await expect(new ProductivityHttpClient(baseUrl, 100).listTasks(context, { page: 1, limit: 20 }))
      .rejects.toMatchObject({ code: AIErrorCode.AI_PRODUCTIVITY_TIMEOUT });
  });

  it.each(writeCases)("maps $name to a fixed authenticated Productivity route", async (item) => {
    handler = (incoming, response) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk as Buffer));
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown : undefined;
        expect(incoming.method).toBe(item.method);
        expect(incoming.url).toBe(item.path);
        expect(incoming.headers.authorization).toBe("Bearer private-token");
        expect(incoming.headers["x-correlation-id"]).toBe("trace-1");
        expect(incoming.headers["x-idempotency-key"]).toBe("00000000-0000-4000-8000-000000000099");
        expect(body).toEqual(item.body);
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ id: taskId, title: "Safe", privateField: "secret" }));
      })();
    };
    const call = validateWriteCall({ id: "call", name: item.name, arguments: item.args });
    if (!call) throw new Error("Test tool was not registered");
    const result = await new ProductivityHttpClient(baseUrl, 1000).execute(context, call, "00000000-0000-4000-8000-000000000099");
    expect(result).toEqual({ id: taskId });
  });

  it("maps write validation and timeout failures without exposing raw upstream bodies", async () => {
    const call = validateWriteCall({ id: "call", name: "create_task", arguments: { title: "Read" } });
    if (!call) throw new Error("Test tool was not registered");
    handler = (_request, response) => { response.statusCode = 400; response.end("private stack and secret"); };
    await expect(new ProductivityHttpClient(baseUrl, 1000).execute(context, call, taskId))
      .rejects.toMatchObject({ code: AIErrorCode.AI_PRODUCTIVITY_REJECTED });
    handler = (_request, response) => { response.statusCode = 503; response.end("private stack and secret"); };
    await expect(new ProductivityHttpClient(baseUrl, 1000).execute(context, call, taskId))
      .rejects.toMatchObject({ code: AIErrorCode.AI_PRODUCTIVITY_UNAVAILABLE });
    handler = (_request, response) => response.end(JSON.stringify({ title: "missing ID" }));
    await expect(new ProductivityHttpClient(baseUrl, 1000).execute(context, call, taskId))
      .rejects.toMatchObject({ code: AIErrorCode.AI_PRODUCTIVITY_INVALID_RESPONSE });
    handler = () => undefined;
    await expect(new ProductivityHttpClient(baseUrl, 100).execute(context, call, taskId))
      .rejects.toMatchObject({ code: AIErrorCode.AI_PRODUCTIVITY_TIMEOUT });
  });
});
