import type { OutboxEventInput } from "@lifehelper/shared-types";
import type { AIActionLogRepository } from "../repositories/ai.repositories";
import type { ProductivityWriteClient } from "../ports/productivity-write.port";
import { AIActionUseCases } from "./ai-action.use-cases";
import { validateWriteCall } from "../services/ai-write-tools";
import type { AIActionLog } from "../../domain/entities/ai-action-log.entity";

it("measures execution with a monotonic clock despite a wall-clock adjustment", async () => {
  const context = {
    userId: "00000000-0000-4000-8000-000000000001",
    accessToken: "private",
    correlationId: "trace-1",
  };
  const call = validateWriteCall({
    id: "call-1",
    name: "create_task",
    arguments: { title: "Private" },
  })!;
  let stored: AIActionLog;
  const saveWithEvent = jest
    .fn<Promise<void>, [AIActionLog, OutboxEventInput]>()
    .mockImplementation(async (action) => {
      stored = action;
    });
  const finalize = jest
    .fn<Promise<void>, [AIActionLog, OutboxEventInput]>()
    .mockResolvedValue(undefined);
  const actions = {
    saveWithEvent,
    findByIdAndUserId: jest.fn(async () => stored),
    claim: jest.fn(async () => true),
    finalize,
  } as unknown as AIActionLogRepository;
  const productivity = {
    execute: jest.fn(async () => ({
      id: "00000000-0000-4000-8000-000000000002",
    })),
  } as ProductivityWriteClient;
  const wallClock = jest
    .fn()
    .mockReturnValueOnce(new Date("2026-10-01T00:00:00Z"))
    .mockReturnValueOnce(new Date("2026-09-30T23:59:00Z"))
    .mockReturnValueOnce(new Date("2026-09-30T23:58:00Z"))
    .mockReturnValue(new Date("2026-09-30T23:57:00Z"));
  const elapsedNow = jest.fn().mockReturnValueOnce(10).mockReturnValueOnce(35);
  const useCases = new AIActionUseCases(
    actions,
    productivity,
    600,
    wallClock,
    () => "00000000-0000-4000-8000-000000000003",
    elapsedNow,
  );

  const pending = await useCases.request(
    context,
    "00000000-0000-4000-8000-000000000004",
    call,
  );
  const result = await useCases.confirm(
    context,
    pending.actionId,
    pending.payloadHash,
  );

  expect(result.status).toBe("SUCCESS");
  expect(stored!.state.durationMs).toBe(25);
  expect(finalize.mock.calls[0]?.[1]).toMatchObject({
    eventType: "ai.tool.executed",
    payload: { correlationId: "trace-1", payload: { durationMs: 25 } },
  });
  expect(JSON.stringify(saveWithEvent.mock.calls[0]?.[1])).not.toContain(
    "Private",
  );
});
