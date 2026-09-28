import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { AIErrorCode } from "../../application/errors/ai.errors";
import { ProductivityHttpClient } from "./productivity-http.client";

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
});
