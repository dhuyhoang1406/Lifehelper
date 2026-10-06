import type {
  AIToolCall,
  AIToolDefinition,
  AIJsonObject,
} from "../ports/ai-provider.port";
import type {
  ProductivityReadClient,
  ToolUserContext,
} from "../ports/productivity-read.port";
import { invalidAIToolCall } from "../errors/ai.errors";
import {
  WRITE_TOOL_DEFINITIONS,
  validateWriteCall,
  type ValidatedWriteCall,
} from "./ai-write-tools";
import { validateToolTimestamp } from "./ai-tool-time";

type ToolName = "get_tasks" | "get_today_tasks" | "get_schedule";
type ValidatedCall = { id: string; name: ToolName; arguments: AIJsonObject };
const statuses = ["TODO", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
const limit = 20;

const definitions: readonly AIToolDefinition[] = [
  {
    name: "get_tasks",
    description:
      "List the authenticated user's tasks. Use a bounded page and optional status or title search.",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "integer", minimum: 1, maximum: 100 },
        limit: { type: "integer", minimum: 1, maximum: 20 },
        status: { type: "string", enum: [...statuses] },
        search: { type: "string", maxLength: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_today_tasks",
    description:
      "List tasks due today in the user's IANA timezone. Timezone is required; do not guess it.",
    inputSchema: {
      type: "object",
      properties: {
        timezone: { type: "string", maxLength: 64 },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["timezone"],
      additionalProperties: false,
    },
  },
  {
    name: "get_schedule",
    description:
      "List the user's calendar events overlapping an explicit ISO-8601 timestamp range. Include timezone and UTC offset in timestamps.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", format: "date-time" },
        to: { type: "string", format: "date-time" },
        timezone: { type: "string", maxLength: 64 },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["from", "to", "timezone"],
      additionalProperties: false,
    },
  },
];

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw invalidAIToolCall("Tool call contains unsupported arguments");
}

function boundedInteger(value: unknown, maximum: number): number | undefined {
  if (value === undefined) return undefined;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > maximum
  )
    throw invalidAIToolCall("Tool call contains an invalid integer");
  return value as number;
}

function timezone(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 64)
    throw invalidAIToolCall("Tool call requires a valid timezone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    throw invalidAIToolCall("Tool call requires a valid timezone");
  }
  return value;
}

function localDate(now: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function startOfLocalDate(date: string, zone: string): Date {
  const target = Date.parse(`${date}T00:00:00.000Z`);
  let candidate = target;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 3; i++) {
    const parts = formatter.formatToParts(candidate);
    const part = (type: string) =>
      Number(parts.find((entry) => entry.type === type)?.value);
    const localAsUtc = Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      part("minute"),
      part("second"),
    );
    candidate += target - localAsUtc;
  }
  return new Date(candidate);
}

export class AIToolRegistry {
  constructor(
    private readonly productivity: ProductivityReadClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get definitions(): readonly AIToolDefinition[] {
    return [...definitions, ...WRITE_TOOL_DEFINITIONS];
  }

  validate(call: AIToolCall): ValidatedCall | ValidatedWriteCall {
    if (
      !call ||
      typeof call.id !== "string" ||
      !call.id ||
      call.id.length > 128 ||
      !object(call.arguments)
    )
      throw invalidAIToolCall("Malformed tool call");
    const args = call.arguments;
    switch (call.name) {
      case "get_tasks": {
        assertKeys(args, ["page", "limit", "status", "search"]);
        boundedInteger(args.page, 100);
        boundedInteger(args.limit, limit);
        if (
          args.status !== undefined &&
          !statuses.includes(args.status as (typeof statuses)[number])
        )
          throw invalidAIToolCall("Invalid task status");
        if (
          args.search !== undefined &&
          (typeof args.search !== "string" ||
            !args.search.trim() ||
            args.search.length > 100)
        )
          throw invalidAIToolCall("Invalid task search");
        break;
      }
      case "get_today_tasks":
        assertKeys(args, ["timezone", "limit"]);
        timezone(args.timezone);
        boundedInteger(args.limit, limit);
        break;
      case "get_schedule": {
        assertKeys(args, ["from", "to", "timezone", "limit"]);
        timezone(args.timezone);
        const from = validateToolTimestamp(args.from);
        const to = validateToolTimestamp(args.to);
        const duration = Date.parse(to) - Date.parse(from);
        if (duration <= 0 || duration > 31 * 24 * 60 * 60 * 1000)
          throw invalidAIToolCall("Invalid calendar range");
        boundedInteger(args.limit, 50);
        break;
      }
      default: {
        const write = validateWriteCall(call);
        if (write) return write;
        throw invalidAIToolCall("Unknown tool name");
      }
    }
    return { id: call.id, name: call.name, arguments: args };
  }

  async execute(
    call: ValidatedCall | ValidatedWriteCall,
    context: ToolUserContext,
  ): Promise<AIJsonObject> {
    if ("risk" in call)
      throw invalidAIToolCall("Write tools require confirmation");
    const args = call.arguments;
    if (call.name === "get_tasks") {
      const page = await this.productivity.listTasks(context, {
        page: (args.page as number | undefined) ?? 1,
        limit: (args.limit as number | undefined) ?? limit,
        status: args.status as string | undefined,
        search: args.search as string | undefined,
      });
      return {
        items: page.items,
        total: page.total,
        page: (args.page as number | undefined) ?? 1,
      } as unknown as AIJsonObject;
    }
    if (call.name === "get_today_tasks") {
      const zone = args.timezone as string;
      const day = localDate(this.now(), zone);
      const tomorrow = new Date(Date.parse(`${day}T00:00:00.000Z`) + 86400000)
        .toISOString()
        .slice(0, 10);
      const from = startOfLocalDate(day, zone).toISOString();
      const to = startOfLocalDate(tomorrow, zone).toISOString();
      const page = await this.productivity.listTasks(context, {
        page: 1,
        limit: (args.limit as number | undefined) ?? limit,
        dueFrom: from,
        dueTo: to,
      });
      return {
        date: day,
        timezone: zone,
        items: page.items,
        total: page.total,
      } as unknown as AIJsonObject;
    }
    const events = await this.productivity.listCalendar(context, {
      from: args.from as string,
      to: args.to as string,
      limit: (args.limit as number | undefined) ?? 50,
    });
    return {
      timezone: args.timezone as string,
      items: events,
    } as unknown as AIJsonObject;
  }
}
