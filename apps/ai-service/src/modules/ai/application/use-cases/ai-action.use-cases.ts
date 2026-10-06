import { createHash, randomUUID } from "node:crypto";
import type { AIJsonObject, AIResponse } from "../ports/ai-provider.port";
import { actionAuditFields, aiOutboxEvent } from "../services/ai-audit-events";
import type { ToolUserContext } from "../ports/productivity-read.port";
import type { ProductivityWriteClient } from "../ports/productivity-write.port";
import type { AIActionLogRepository } from "../repositories/ai.repositories";
import { AIApplicationError, AIErrorCode } from "../errors/ai.errors";
import type { ValidatedWriteCall } from "../services/ai-write-tools";
import { validateWriteCall } from "../services/ai-write-tools";
import { AIActionLog } from "../../domain/entities/ai-action-log.entity";
import { AIActionStatus } from "../../domain/enums/ai.enums";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => JSON.stringify(key) + ":" + canonical(nested))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
function hash(userId: string, name: string, args: AIJsonObject): string {
  return createHash("sha256")
    .update(canonical({ userId, name, args }))
    .digest("hex");
}
const notFound = () =>
  new AIApplicationError(
    AIErrorCode.AI_ACTION_NOT_FOUND,
    "Action not found",
    404,
  );

export class AIActionUseCases {
  constructor(
    private readonly actions: AIActionLogRepository,
    private readonly productivity: ProductivityWriteClient,
    private readonly ttlSeconds: number,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
    private readonly elapsedNow: () => number = () => performance.now(),
  ) {}

  async request(
    context: ToolUserContext,
    conversationId: string,
    call: ValidatedWriteCall,
    source?: Pick<AIResponse, "metadata" | "usage">,
  ) {
    const at = this.now();
    const expiresAt = new Date(at.getTime() + this.ttlSeconds * 1000);
    const payloadHash = hash(context.userId, call.name, call.arguments);
    const action = AIActionLog.create({
      id: this.newId(),
      userId: context.userId,
      conversationId,
      toolName: call.name,
      correlationId: context.correlationId,
      provider: source?.metadata.provider,
      model: source?.metadata.model,
      inputTokens: source?.usage.inputTokens,
      outputTokens: source?.usage.outputTokens,
      inputPayload: call.arguments,
      payloadHash,
      idempotencyKey: this.newId(),
      expiresAt,
      createdAt: at,
    });
    await this.actions.saveWithEvent(
      action,
      aiOutboxEvent({
        type: "ai.requested",
        aggregateType: "action",
        aggregateId: action.state.id,
        correlationId: context.correlationId,
        occurredAt: at,
        payload: {
          actionId: action.state.id,
          conversationId,
          toolName: call.name,
          ...actionAuditFields(call),
        },
      }),
    );
    return {
      actionId: action.state.id,
      status: AIActionStatus.REQUESTED,
      toolName: call.name,
      risk: call.risk,
      arguments: call.arguments,
      payloadHash,
      expiresAt: expiresAt.toISOString(),
      confirmationRequired: true,
    };
  }

  async get(context: ToolUserContext, id: string) {
    const action = await this.actions.findByIdAndUserId(id, context.userId);
    if (!action) throw notFound();
    return this.view(action);
  }

  async recentForConversation(userId: string, conversationId: string) {
    const page = await this.actions.findPageByConversationAndUserId(
      conversationId,
      userId,
      { page: 1, limit: 10 },
    );
    return page.items.map((action) => ({
      actionId: action.state.id,
      toolName: action.state.toolName,
      status: action.state.status,
      resourceId:
        typeof action.state.outputPayload === "object" &&
        action.state.outputPayload !== null &&
        !Array.isArray(action.state.outputPayload) &&
        typeof action.state.outputPayload.id === "string"
          ? action.state.outputPayload.id
          : null,
      errorCode: action.state.errorCode,
    }));
  }

  async reject(context: ToolUserContext, id: string, payloadHash: string) {
    const action = await this.checked(context, id, payloadHash);
    if (action.state.status === AIActionStatus.REJECTED)
      return this.view(action);
    if (action.state.status !== AIActionStatus.REQUESTED)
      throw new AIApplicationError(
        AIErrorCode.AI_TOOL_CALL_INVALID,
        "Action cannot be rejected",
        409,
      );
    action.reject("USER_REJECTED");
    const changed = await this.actions.rejectIfRequested(
      id,
      context.userId,
      payloadHash,
      "USER_REJECTED",
      this.actionEvent(action, context, "ai.failed", "USER_REJECTED"),
    );
    if (!changed) return this.get(context, id);
    return this.get(context, id);
  }

  async confirm(context: ToolUserContext, id: string, payloadHash: string) {
    const action = await this.checked(context, id, payloadHash);
    if (action.state.status !== AIActionStatus.REQUESTED)
      return this.view(action);
    if (!action.state.expiresAt || action.state.expiresAt <= this.now()) {
      action.reject("ACTION_EXPIRED");
      await this.actions.rejectIfRequested(
        id,
        context.userId,
        payloadHash,
        "ACTION_EXPIRED",
        this.actionEvent(action, context, "ai.failed", "ACTION_EXPIRED"),
      );
      throw new AIApplicationError(
        AIErrorCode.AI_ACTION_EXPIRED,
        "Action confirmation expired",
        410,
      );
    }
    const claimed = await this.actions.claim(
      id,
      context.userId,
      payloadHash,
      this.now(),
    );
    if (!claimed) return this.get(context, id);
    action.start();
    const start = this.elapsedNow();
    try {
      const call = validateWriteCall({
        id: action.state.id,
        name: action.state.toolName,
        arguments: action.state.inputPayload as AIJsonObject,
      });
      if (
        !call ||
        hash(context.userId, call.name, call.arguments) !== payloadHash
      )
        throw new AIApplicationError(
          AIErrorCode.AI_ACTION_PAYLOAD_MISMATCH,
          "Action payload changed",
          409,
        );
      const output = await this.productivity.execute(
        context,
        call,
        action.state.idempotencyKey!,
      );
      if (typeof output.id !== "string")
        throw new AIApplicationError(
          AIErrorCode.AI_PRODUCTIVITY_INVALID_RESPONSE,
          "Productivity returned an invalid action result",
          502,
        );
      action.succeed(
        { id: output.id },
        Math.max(0, Math.round(this.elapsedNow() - start)),
      );
    } catch (error) {
      const code =
        error instanceof AIApplicationError
          ? error.code
          : AIErrorCode.AI_PRODUCTIVITY_UNAVAILABLE;
      action.fail(code, Math.max(0, Math.round(this.elapsedNow() - start)));
    }
    await this.actions.finalize(
      action,
      this.actionEvent(
        action,
        context,
        action.state.errorCode ? "ai.failed" : "ai.tool.executed",
        action.state.errorCode,
      ),
    );
    return this.view(action);
  }

  private actionEvent(
    action: AIActionLog,
    context: ToolUserContext,
    type: "ai.tool.executed" | "ai.failed",
    errorCode: string | null,
  ) {
    const output = action.state.outputPayload;
    const resourceId =
      output &&
      typeof output === "object" &&
      !Array.isArray(output) &&
      typeof output.id === "string"
        ? output.id
        : null;
    return aiOutboxEvent({
      type,
      aggregateType: "action",
      aggregateId: action.state.id,
      correlationId: context.correlationId,
      occurredAt: this.now(),
      payload: {
        actionId: action.state.id,
        toolName: action.state.toolName,
        status: action.state.status,
        provider: action.state.provider,
        model: action.state.model,
        inputTokens: action.state.inputTokens,
        outputTokens: action.state.outputTokens,
        durationMs: action.state.durationMs,
        errorCode,
        resourceId,
      },
    });
  }

  private async checked(
    context: ToolUserContext,
    id: string,
    payloadHash: string,
  ) {
    const action = await this.actions.findByIdAndUserId(id, context.userId);
    if (!action) throw notFound();
    if (
      action.state.payloadHash !== payloadHash ||
      hash(
        context.userId,
        action.state.toolName,
        action.state.inputPayload as AIJsonObject,
      ) !== payloadHash
    )
      throw new AIApplicationError(
        AIErrorCode.AI_ACTION_PAYLOAD_MISMATCH,
        "Action payload changed",
        409,
      );
    return action;
  }

  private view(action: AIActionLog) {
    const {
      id,
      toolName,
      inputPayload,
      outputPayload,
      status,
      errorCode,
      expiresAt,
      payloadHash,
    } = action.state;
    return {
      actionId: id,
      toolName,
      arguments: inputPayload,
      status,
      output: outputPayload,
      errorCode,
      expiresAt,
      payloadHash,
    };
  }
}
