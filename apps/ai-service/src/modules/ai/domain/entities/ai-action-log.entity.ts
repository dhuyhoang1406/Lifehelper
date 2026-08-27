import type { JsonValue, UUID } from "@lifehelper/shared-types";
import { AIActionStatus } from "../enums/ai.enums";
import { AIDomainError } from "../errors/ai-domain.error";
export interface AIActionLogProps {
  id: UUID;
  userId: UUID;
  conversationId: UUID | null;
  messageId: UUID | null;
  toolName: string;
  inputPayload: JsonValue;
  outputPayload: JsonValue | null;
  status: AIActionStatus;
  errorCode: string | null;
  durationMs: number | null;
  createdAt: Date;
}
export class AIActionLog {
  private constructor(private props: AIActionLogProps) {}
  static create(
    input: Pick<
      AIActionLogProps,
      "id" | "userId" | "toolName" | "inputPayload"
    > &
      Partial<
        Pick<AIActionLogProps, "conversationId" | "messageId" | "createdAt">
      >,
  ): AIActionLog {
    if (!input.toolName.trim())
      throw new AIDomainError("Tool name is required");
    return new AIActionLog({
      ...input,
      toolName: input.toolName.trim(),
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      outputPayload: null,
      status: AIActionStatus.REQUESTED,
      errorCode: null,
      durationMs: null,
      createdAt: input.createdAt ?? new Date(),
    });
  }
  static restore(p: AIActionLogProps): AIActionLog {
    return new AIActionLog(p);
  }
  get state(): Readonly<AIActionLogProps> {
    return this.props;
  }
  succeed(output: JsonValue, durationMs: number): void {
    this.ensureDuration(durationMs);
    this.props.status = AIActionStatus.SUCCESS;
    this.props.outputPayload = output;
    this.props.durationMs = durationMs;
  }
  fail(errorCode: string, durationMs: number): void {
    this.ensureDuration(durationMs);
    this.props.status = AIActionStatus.FAILED;
    this.props.errorCode = errorCode;
    this.props.durationMs = durationMs;
  }
  reject(errorCode: string): void {
    this.props.status = AIActionStatus.REJECTED;
    this.props.errorCode = errorCode;
  }
  private ensureDuration(ms: number): void {
    if (ms < 0) throw new AIDomainError("Duration cannot be negative");
  }
}
