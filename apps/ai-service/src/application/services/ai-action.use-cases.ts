import { createHash, randomUUID } from "node:crypto";
import type { AIJsonObject } from "../ports/ai-provider.port";
import type { ToolUserContext } from "../ports/productivity-read.port";
import type { ProductivityWriteClient } from "../ports/productivity-write.port";
import type { AIActionLogRepository } from "../repositories/ai.repositories";
import { AIApplicationError, AIErrorCode } from "../errors/ai.errors";
import type { ValidatedWriteCall } from "./ai-write-tools";
import { validateWriteCall } from "./ai-write-tools";
import { AIActionLog } from "../../modules/ai/domain/entities/ai-action-log.entity";
import { AIActionStatus } from "../../modules/ai/domain/enums/ai.enums";

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
  ) {}

  async request(
    context: ToolUserContext,
    conversationId: string,
    call: ValidatedWriteCall,
  ) {
    const at = this.now();
    const expiresAt = new Date(at.getTime() + this.ttlSeconds * 1000);
    const payloadHash = hash(context.userId, call.name, call.arguments);
    const action = AIActionLog.create({
      id: this.newId(),
      userId: context.userId,
      conversationId,
      toolName: call.name,
      inputPayload: call.arguments,
      payloadHash,
      idempotencyKey: this.newId(),
      expiresAt,
      createdAt: at,
    });
    await this.actions.save(action);
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
    const changed = await this.actions.rejectIfRequested(
      id,
      context.userId,
      payloadHash,
      "USER_REJECTED",
    );
    if (!changed) return this.get(context, id);
    return this.get(context, id);
  }

  async confirm(context: ToolUserContext, id: string, payloadHash: string) {
    const action = await this.checked(context, id, payloadHash);
    if (action.state.status !== AIActionStatus.REQUESTED)
      return this.view(action);
    if (!action.state.expiresAt || action.state.expiresAt <= this.now()) {
      await this.actions.rejectIfRequested(
        id,
        context.userId,
        payloadHash,
        "ACTION_EXPIRED",
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
    const start = this.now().getTime();
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
      action.succeed(output, Math.max(0, this.now().getTime() - start));
    } catch (error) {
      const code =
        error instanceof AIApplicationError
          ? error.code
          : AIErrorCode.AI_PRODUCTIVITY_UNAVAILABLE;
      action.fail(code, Math.max(0, this.now().getTime() - start));
    }
    await this.actions.finalize(action);
    return this.view(action);
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
