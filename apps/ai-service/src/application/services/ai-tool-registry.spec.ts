import type { AIToolCall } from "../ports/ai-provider.port";
import type { ProductivityReadClient, ToolUserContext } from "../ports/productivity-read.port";
import { AIToolRegistry } from "./ai-tool-registry";

const context: ToolUserContext = {
  userId: "user-a", accessToken: "verified-token-a", correlationId: "request-1",
};
const client: jest.Mocked<ProductivityReadClient> = {
  listTasks: jest.fn(), listCalendar: jest.fn(),
};
const call = (name: string, args: Record<string, unknown>): AIToolCall => ({
  id: "call-1", name, arguments: args as AIToolCall["arguments"],
});

describe("AI read-tool registry", () => {
  const registry = new AIToolRegistry(client, () => new Date("2026-03-08T15:00:00.000Z"));
  beforeEach(() => jest.clearAllMocks());

  it("exposes only explicit read tools", () => {
    expect(registry.definitions.map((tool) => tool.name)).toEqual([
      "get_tasks", "get_today_tasks", "get_schedule",
    ]);
    expect(registry.definitions.every((tool) => tool.inputSchema.additionalProperties === false)).toBe(true);
  });

  it.each([
    call("delete_task", {}),
    call("get_tasks", { userId: "user-b" }),
    call("get_tasks", { status: "ADMIN" }),
    call("get_tasks", { search: "x".repeat(101) }),
    call("get_tasks", { limit: 1000 }),
    call("get_today_tasks", { timezone: "not/a-zone" }),
    call("get_schedule", { from: "2026-03-08", to: "2026-03-09", timezone: "UTC" }),
    call("get_schedule", { from: "2026-02-30T00:00:00Z", to: "2026-03-02T00:00:00Z", timezone: "UTC" }),
    call("get_schedule", { from: "2026-03-01T00:00:00+14:30", to: "2026-03-02T00:00:00+14:30", timezone: "UTC" }),
    call("get_schedule", { from: "2026-03-09T00:00:00Z", to: "2026-03-08T00:00:00Z", timezone: "UTC" }),
  ])("rejects unknown or malformed tool calls before any client request", (tool) => {
    expect(() => registry.validate(tool)).toThrow();
    expect(client.listTasks).not.toHaveBeenCalled();
    expect(client.listCalendar).not.toHaveBeenCalled();
  });

  it("propagates authenticated context, not a model-selected user", async () => {
    client.listTasks.mockResolvedValue({ items: [], total: 0 });
    const result = await registry.execute(registry.validate(call("get_tasks", { status: "TODO" })), context);
    expect(result).toMatchObject({ items: [], total: 0 });
    expect(client.listTasks).toHaveBeenCalledWith(context, {
      page: 1, limit: 20, status: "TODO", search: undefined,
    });
  });

  it("computes today's UTC range from the supplied timezone, including DST", async () => {
    client.listTasks.mockResolvedValue({ items: [], total: 0 });
    await registry.execute(registry.validate(call("get_today_tasks", { timezone: "America/New_York" })), context);
    expect(client.listTasks).toHaveBeenCalledWith(context, {
      page: 1, limit: 20,
      dueFrom: "2026-03-08T05:00:00.000Z",
      dueTo: "2026-03-09T04:00:00.000Z",
    });
  });

  it("preserves explicit offset timestamps and timezone for schedule reads", async () => {
    client.listCalendar.mockResolvedValue([]);
    const args = { from: "2026-03-08T00:00:00+07:00", to: "2026-03-09T00:00:00+07:00", timezone: "Asia/Ho_Chi_Minh" };
    await registry.execute(registry.validate(call("get_schedule", args)), context);
    expect(client.listCalendar).toHaveBeenCalledWith(context, { from: args.from, to: args.to, limit: 50 });
  });
});
