import { AIApplicationError, AIErrorCode } from "../../application/errors/ai.errors";
import type {
  CalendarSummary, ProductivityReadClient, TaskSummary, ToolUserContext,
} from "../../application/ports/productivity-read.port";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function string(value: unknown): string {
  if (typeof value !== "string") throw invalidResponse();
  return value;
}

function invalidResponse(): AIApplicationError {
  return new AIApplicationError(
    AIErrorCode.AI_PRODUCTIVITY_INVALID_RESPONSE,
    "Productivity Service returned invalid data",
    502,
  );
}

function task(value: unknown): TaskSummary {
  if (!record(value)) throw invalidResponse();
  return {
    id: string(value.id), title: string(value.title),
    status: string(value.status), priority: string(value.priority),
    dueAt: value.dueAt == null ? null : string(value.dueAt),
  };
}

function event(value: unknown): CalendarSummary {
  if (!record(value)) throw invalidResponse();
  return {
    id: string(value.id), title: string(value.title),
    eventType: string(value.eventType), startAt: string(value.startAt),
    endAt: string(value.endAt), timezone: string(value.timezone),
  };
}

export class ProductivityHttpClient implements ProductivityReadClient {
  private readonly baseUrl: URL;

  constructor(baseUrl: string, private readonly timeoutMs: number, private readonly transport: typeof fetch = fetch) {
    this.baseUrl = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  }

  async listTasks(
    context: ToolUserContext,
    query: { page: number; limit: number; status?: string; search?: string; dueFrom?: string; dueTo?: string },
  ): Promise<{ items: TaskSummary[]; total: number }> {
    const params = new URLSearchParams({ page: String(query.page), limit: String(query.limit) });
    for (const key of ["status", "search", "dueFrom", "dueTo"] as const)
      if (query[key] !== undefined) params.set(key, query[key]);
    const payload = await this.get("tasks", params, context);
    if (!record(payload) || !Array.isArray(payload.items) || payload.items.length > query.limit ||
        !Number.isSafeInteger(payload.total) || (payload.total as number) < 0)
      throw invalidResponse();
    return { items: payload.items.map(task), total: payload.total as number };
  }

  async listCalendar(
    context: ToolUserContext,
    query: { from: string; to: string; limit: number },
  ): Promise<CalendarSummary[]> {
    const params = new URLSearchParams({ from: query.from, to: query.to, page: "1", limit: String(query.limit) });
    const payload = await this.get("calendar-events", params, context);
    if (!Array.isArray(payload) || payload.length > query.limit) throw invalidResponse();
    return payload.map(event);
  }

  private async get(path: "tasks" | "calendar-events", params: URLSearchParams, context: ToolUserContext): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    url.search = params.toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport(url, {
        method: "GET",
        redirect: "error",
        headers: {
          authorization: `Bearer ${context.accessToken}`,
          "x-correlation-id": context.correlationId,
        },
        signal: controller.signal,
      });
      if (!response.ok)
        throw new AIApplicationError(
          AIErrorCode.AI_PRODUCTIVITY_UNAVAILABLE,
          "Productivity Service is unavailable",
          502,
        );
      try {
        return await response.json() as unknown;
      } catch {
        throw invalidResponse();
      }
    } catch (error) {
      if (error instanceof AIApplicationError) throw error;
      if (controller.signal.aborted)
        throw new AIApplicationError(AIErrorCode.AI_PRODUCTIVITY_TIMEOUT, "Productivity Service timed out", 504);
      throw new AIApplicationError(AIErrorCode.AI_PRODUCTIVITY_UNAVAILABLE, "Productivity Service is unavailable", 502);
    } finally {
      clearTimeout(timer);
    }
  }
}
