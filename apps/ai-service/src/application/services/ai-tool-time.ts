import { invalidAIToolCall } from "../errors/ai.errors";

export function validateToolTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(
      value,
    )
  )
    throw invalidAIToolCall(
      "Tool range requires ISO-8601 timestamps with offsets",
    );
  const parsed = Date.parse(value);
  const offset = value.match(/([+-])(\d{2}):(\d{2})$/);
  if (!Number.isFinite(parsed) || (offset?.[2] === "14" && offset[3] !== "00"))
    throw invalidAIToolCall("Tool range contains an invalid timestamp");
  const offsetMinutes = offset
    ? (offset[1] === "+" ? 1 : -1) *
      (Number(offset[2]) * 60 + Number(offset[3]))
    : 0;
  const local = new Date(parsed + offsetMinutes * 60_000).toISOString();
  if (local.slice(0, 19) !== value.slice(0, 19))
    throw invalidAIToolCall("Tool range contains an invalid timestamp");
  return value;
}
