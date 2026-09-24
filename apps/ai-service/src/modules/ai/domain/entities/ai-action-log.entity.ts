import type { JsonValue, UUID } from "@lifehelper/shared-types";
import { AIActionStatus } from "../enums/ai.enums";
import { AIDomainError } from "../errors/ai-domain.error";

const SENSITIVE_PAYLOAD_KEYS = new Set([
  "authorization",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "password",
  "secret",
  "cookie",
  "setcookie",
]);

const normalizedKey = (key: string) =>
  key.replace(/[^a-z0-9]/gi, "").toLowerCase();

const ensureSafePayload = (value: JsonValue): void => {
  if (Array.isArray(value)) {
    value.forEach(ensureSafePayload);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_PAYLOAD_KEYS.has(normalizedKey(key)))
      throw new AIDomainError(`Sensitive field ${key} cannot be persisted`);
    ensureSafePayload(nested);
  }
};
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
    if (input.toolName.trim().length > 100)
      throw new AIDomainError("Tool name cannot exceed 100 characters");
    ensureSafePayload(input.inputPayload);
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
    ensureSafePayload(output);
    this.props.status = AIActionStatus.SUCCESS;
    this.props.outputPayload = output;
    this.props.durationMs = durationMs;
  }
  fail(errorCode: string, durationMs: number): void {
    this.ensureDuration(durationMs);
    this.ensureErrorCode(errorCode);
    this.props.status = AIActionStatus.FAILED;
    this.props.errorCode = errorCode;
    this.props.durationMs = durationMs;
  }
  reject(errorCode: string): void {
    this.ensureErrorCode(errorCode);
    this.props.status = AIActionStatus.REJECTED;
    this.props.errorCode = errorCode;
  }
  private ensureDuration(ms: number): void {
    if (!Number.isSafeInteger(ms) || ms < 0)
      throw new AIDomainError("Duration must be a non-negative integer");
  }
  private ensureErrorCode(errorCode: string): void {
    if (!errorCode.trim()) throw new AIDomainError("Error code is required");
    if (errorCode.trim().length > 100)
      throw new AIDomainError("Error code cannot exceed 100 characters");
  }
}
