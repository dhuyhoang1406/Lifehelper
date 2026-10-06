import type { AIToolCall } from "../ports/ai-provider.port";
import { validateWriteCall, WRITE_TOOL_DEFINITIONS } from "./ai-write-tools";

const taskId = "00000000-0000-4000-8000-000000000001";
const call = (name: string, args: Record<string, unknown>): AIToolCall => ({
  id: "call-1",
  name,
  arguments: args as AIToolCall["arguments"],
});
const valid = [
  call("create_task", { title: "Read" }),
  call("update_task", { taskId, title: "Updated" }),
  call("complete_task", { taskId }),
  call("create_calendar_event", {
    title: "Meeting",
    eventType: "MEETING",
    startAt: "2026-03-08T08:00:00-04:00",
    endAt: "2026-03-08T09:00:00-04:00",
    timezone: "America/New_York",
  }),
  call("create_reminder", {
    resourceType: "CUSTOM",
    title: "Call",
    remindAt: "2026-03-08T08:00:00-04:00",
    timezone: "America/New_York",
  }),
  call("create_habit", {
    name: "Walk",
    frequencyType: "DAILY",
    timezone: "Asia/Ho_Chi_Minh",
    startDate: "2026-10-12",
  }),
  call("log_habit", {
    habitId: taskId,
    logDate: "2026-10-12",
    timezone: "Asia/Ho_Chi_Minh",
  }),
];

describe("AI write tool schemas", () => {
  it("registers exactly seven explicit write tools", () => {
    expect(WRITE_TOOL_DEFINITIONS.map(({ name }) => name)).toEqual(
      valid.map(({ name }) => name),
    );
    expect(valid.map(validateWriteCall).every(Boolean)).toBe(true);
  });

  it.each([
    call("create_task", { title: "Read", userId: taskId }),
    call("create_task", { title: "x".repeat(256) }),
    call("create_task", { title: "Read", dueAt: "2026-10-12T18:00:00+07:00" }),
    call("update_task", { taskId }),
    call("update_task", { taskId, timezone: "UTC" }),
    call("complete_task", { taskId: "not-uuid" }),
    call("create_calendar_event", {
      title: "Bad",
      eventType: "MEETING",
      startAt: "2026-03-08T09:00:00-04:00",
      endAt: "2026-03-08T08:00:00-04:00",
      timezone: "America/New_York",
    }),
    call("create_calendar_event", {
      title: "Bad",
      eventType: "MEETING",
      startAt: "2026-03-08T02:30:00-05:00",
      endAt: "2026-03-08T03:30:00-04:00",
      timezone: "America/New_York",
    }),
    call("create_calendar_event", {
      title: "Bad",
      eventType: "MEETING",
      startAt: "2026-02-30T08:00:00Z",
      endAt: "2026-03-01T09:00:00Z",
      timezone: "UTC",
    }),
    call("create_reminder", {
      resourceType: "TASK",
      title: "Bad",
      remindAt: "2026-10-12T08:00:00+07:00",
      timezone: "Asia/Ho_Chi_Minh",
    }),
    call("create_reminder", {
      resourceType: "CUSTOM",
      title: "Bad",
      remindAt: "tomorrow 8",
      timezone: "Asia/Ho_Chi_Minh",
    }),
    call("create_habit", {
      name: "Bad",
      frequencyType: "DAILY",
      timezone: "Bad/Zone",
      startDate: "2026-10-12",
    }),
    call("create_habit", {
      name: "Bad",
      frequencyType: "DAILY",
      timezone: "UTC",
      startDate: "2026-02-30",
    }),
    call("log_habit", {
      habitId: taskId,
      logDate: "2026-10-12",
      timezone: "Asia/Ho_Chi_Minh",
      completedCount: 0,
    }),
  ])("rejects malformed or malicious arguments before execution", (tool) => {
    expect(() => validateWriteCall(tool)).toThrow();
  });

  it("accepts a valid post-DST offset but rejects an offset that contradicts the zone", () => {
    expect(
      validateWriteCall(
        call("create_reminder", {
          resourceType: "CUSTOM",
          title: "Valid",
          remindAt: "2026-03-08T03:30:00-04:00",
          timezone: "America/New_York",
        }),
      ),
    ).not.toBeNull();
    expect(() =>
      validateWriteCall(
        call("create_reminder", {
          resourceType: "CUSTOM",
          title: "Invalid",
          remindAt: "2026-03-08T03:30:00-05:00",
          timezone: "America/New_York",
        }),
      ),
    ).toThrow();
  });
});
