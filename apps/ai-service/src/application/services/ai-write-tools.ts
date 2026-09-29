import type {
  AIJsonObject,
  AIToolCall,
  AIToolDefinition,
} from "../ports/ai-provider.port";
import { invalidAIToolCall } from "../errors/ai.errors";
import { validateToolTimestamp } from "./ai-tool-time";

export type AIWriteToolName =
  | "create_task"
  | "update_task"
  | "complete_task"
  | "create_calendar_event"
  | "create_reminder"
  | "create_habit"
  | "log_habit";
export type ToolRisk =
  "READ_ONLY" | "WRITE_LOW_RISK" | "SENSITIVE_OR_DESTRUCTIVE";
export interface ValidatedWriteCall {
  id: string;
  name: AIWriteToolName;
  arguments: AIJsonObject;
  risk: Exclude<ToolRisk, "READ_ONLY">;
}

const field = (type: string, extras: AIJsonObject = {}): AIJsonObject => ({
  type,
  ...extras,
});
const text = (maximum: number): AIJsonObject =>
  field("string", { minLength: 1, maxLength: maximum });
const dateTime = field("string", { format: "date-time" });
const uuid = field("string", { format: "uuid" });
const zone = text(64);
const obj = (properties: AIJsonObject, required: string[]): AIJsonObject => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const WRITE_TOOL_DEFINITIONS: readonly AIToolDefinition[] = [
  {
    name: "create_task",
    description:
      "Propose a new task for the authenticated user. Confirmation is required. If dueAt is given, include trusted user timezone and ISO-8601 timestamp with offset.",
    inputSchema: obj(
      {
        title: text(255),
        description: text(4000),
        priority: field("string", {
          enum: ["LOW", "MEDIUM", "HIGH", "URGENT"],
        }),
        dueAt: dateTime,
        timezone: zone,
      },
      ["title"],
    ),
  },
  {
    name: "update_task",
    description:
      "Propose changing an existing task by ID. Confirmation is required. If dueAt is given, include trusted user timezone and ISO-8601 timestamp with offset.",
    inputSchema: obj(
      {
        taskId: uuid,
        title: text(255),
        description: text(4000),
        priority: field("string", {
          enum: ["LOW", "MEDIUM", "HIGH", "URGENT"],
        }),
        dueAt: dateTime,
        timezone: zone,
      },
      ["taskId"],
    ),
  },
  {
    name: "complete_task",
    description: "Propose marking a task complete. Confirmation is required.",
    inputSchema: obj({ taskId: uuid }, ["taskId"]),
  },
  {
    name: "create_calendar_event",
    description:
      "Propose a calendar event. Confirmation required. Provide explicit ISO-8601 timestamps with offset and an IANA timezone.",
    inputSchema: obj(
      {
        title: text(255),
        description: text(4000),
        eventType: field("string", {
          enum: ["PERSONAL", "WORK", "STUDY", "INTERVIEW", "MEETING", "OTHER"],
        }),
        startAt: dateTime,
        endAt: dateTime,
        timezone: zone,
      },
      ["title", "eventType", "startAt", "endAt", "timezone"],
    ),
  },
  {
    name: "create_reminder",
    description:
      "Propose a reminder. Confirmation required. Provide explicit remindAt timestamp with offset and IANA timezone.",
    inputSchema: obj(
      {
        resourceType: field("string", {
          enum: ["TASK", "CALENDAR_EVENT", "HABIT", "CUSTOM"],
        }),
        resourceId: uuid,
        title: text(255),
        remindAt: dateTime,
        timezone: zone,
      },
      ["resourceType", "title", "remindAt", "timezone"],
    ),
  },
  {
    name: "create_habit",
    description:
      "Propose a daily, weekly or custom habit. Confirmation required. Provide IANA timezone and local startDate YYYY-MM-DD. Weekly needs dayOfWeek 1-7.",
    inputSchema: obj(
      {
        name: text(180),
        description: text(4000),
        frequencyType: field("string", { enum: ["DAILY", "WEEKLY", "CUSTOM"] }),
        timezone: zone,
        startDate: field("string", { format: "date" }),
        targetCount: field("integer", { minimum: 1, maximum: 1000 }),
        schedules: field("array", {
          maxItems: 7,
          items: obj(
            {
              dayOfWeek: field("integer", { minimum: 1, maximum: 7 }),
              timeOfDay: field("string", { format: "time" }),
            },
            [],
          ),
        }),
      },
      ["name", "frequencyType", "timezone", "startDate"],
    ),
  },
  {
    name: "log_habit",
    description:
      "Propose logging habit completion for a local calendar date in the user's timezone. Confirmation required.",
    inputSchema: obj(
      {
        habitId: uuid,
        logDate: field("string", { format: "date" }),
        timezone: zone,
        completedCount: field("integer", { minimum: 1, maximum: 1000 }),
      },
      ["habitId", "logDate", "timezone"],
    ),
  },
];

const risks: Record<AIWriteToolName, ValidatedWriteCall["risk"]> = {
  create_task: "WRITE_LOW_RISK",
  update_task: "SENSITIVE_OR_DESTRUCTIVE",
  complete_task: "SENSITIVE_OR_DESTRUCTIVE",
  create_calendar_event: "WRITE_LOW_RISK",
  create_reminder: "WRITE_LOW_RISK",
  create_habit: "WRITE_LOW_RISK",
  log_habit: "WRITE_LOW_RISK",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validateValue(value: unknown, schema: AIJsonObject): void {
  if (schema.type === "object") {
    if (!isObject(value))
      throw invalidAIToolCall("Tool arguments must be an object");
    const properties = schema.properties as Record<string, AIJsonObject>;
    const required = schema.required as string[];
    if (
      Object.keys(value).some((key) => !(key in properties)) ||
      required.some((key) => value[key] === undefined)
    )
      throw invalidAIToolCall(
        "Tool arguments contain missing or unsupported fields",
      );
    for (const [key, nested] of Object.entries(value))
      validateValue(nested, properties[key]);
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value) || value.length > Number(schema.maxItems))
      throw invalidAIToolCall("Invalid tool array");
    value.forEach((item) => validateValue(item, schema.items as AIJsonObject));
    return;
  }
  if (schema.type === "integer") {
    if (
      !Number.isSafeInteger(value) ||
      (value as number) < Number(schema.minimum) ||
      (value as number) > Number(schema.maximum)
    )
      throw invalidAIToolCall("Invalid tool integer");
    return;
  }
  if (
    typeof value !== "string" ||
    !value.trim() ||
    (schema.maxLength !== undefined && value.length > Number(schema.maxLength))
  )
    throw invalidAIToolCall("Invalid tool string");
  if (Array.isArray(schema.enum) && !schema.enum.includes(value))
    throw invalidAIToolCall("Invalid tool enum");
  if (
    schema.format === "uuid" &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw invalidAIToolCall("Invalid resource ID");
  if (schema.format === "date-time" && validateToolTimestamp(value) !== value)
    throw invalidAIToolCall("Invalid timestamp");
  if (schema.format === "date") {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? Date.parse(value + "T00:00:00Z")
      : NaN;
    if (
      !Number.isFinite(parsed) ||
      new Date(parsed).toISOString().slice(0, 10) !== value
    )
      throw invalidAIToolCall("Invalid local date");
  }
  if (
    schema.format === "time" &&
    !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)
  )
    throw invalidAIToolCall("Invalid schedule time");
}
function validateTimezone(value: string): void {
  if (value.length > 64) throw invalidAIToolCall("Invalid timezone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    throw invalidAIToolCall("Invalid timezone");
  }
}
function assertZoneOffset(instant: string, zone: string): void {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (name: string) =>
    parts.find((entry) => entry.type === name)?.value;
  const local =
    part("year") +
    "-" +
    part("month") +
    "-" +
    part("day") +
    "T" +
    part("hour") +
    ":" +
    part("minute") +
    ":" +
    part("second");
  if (local !== instant.slice(0, 19))
    throw invalidAIToolCall("Timestamp offset does not match timezone");
}
export function validateWriteCall(call: AIToolCall): ValidatedWriteCall | null {
  const definition = WRITE_TOOL_DEFINITIONS.find(
    (tool) => tool.name === call.name,
  );
  if (!definition) return null;
  if (!call.id || call.id.length > 128)
    throw invalidAIToolCall("Invalid tool call ID");
  validateValue(call.arguments, definition.inputSchema);
  const args = call.arguments;
  if (typeof args.timezone === "string") validateTimezone(args.timezone);
  if (
    (call.name === "create_task" || call.name === "update_task") &&
    args.dueAt !== undefined &&
    args.timezone === undefined
  )
    throw invalidAIToolCall("Task dueAt requires timezone context");
  if (typeof args.timezone === "string")
    for (const key of ["startAt", "endAt", "remindAt", "dueAt"])
      if (typeof args[key] === "string")
        assertZoneOffset(args[key], args.timezone);
  if (
    call.name === "create_calendar_event" &&
    Date.parse(args.endAt as string) <= Date.parse(args.startAt as string)
  )
    throw invalidAIToolCall("Event endAt must be after startAt");
  if (
    call.name === "create_reminder" &&
    ((args.resourceType === "CUSTOM" && args.resourceId !== undefined) ||
      (args.resourceType !== "CUSTOM" && args.resourceId === undefined))
  )
    throw invalidAIToolCall("Invalid reminder resource reference");
  if (
    call.name === "update_task" &&
    !["title", "description", "priority", "dueAt"].some(
      (key) => args[key] !== undefined,
    )
  )
    throw invalidAIToolCall("No task update fields");
  if (call.name === "create_habit") {
    const schedules =
      (args.schedules as
        Array<{ dayOfWeek?: number; timeOfDay?: string }> | undefined) ?? [];
    if (
      args.frequencyType === "WEEKLY" &&
      (!schedules.length ||
        schedules.some((entry) => entry.dayOfWeek === undefined))
    )
      throw invalidAIToolCall("Weekly habit requires weekday schedules");
    if (
      args.frequencyType === "DAILY" &&
      schedules.some((entry) => entry.dayOfWeek !== undefined)
    )
      throw invalidAIToolCall("Daily habit cannot select weekdays");
    const keys = schedules.map(
      (entry) =>
        String(entry.dayOfWeek ?? "daily") + ":" + (entry.timeOfDay ?? "any"),
    );
    if (new Set(keys).size !== keys.length)
      throw invalidAIToolCall("Duplicate habit schedule");
  }
  return {
    id: call.id,
    name: call.name as AIWriteToolName,
    arguments: args,
    risk: risks[call.name as AIWriteToolName],
  };
}
