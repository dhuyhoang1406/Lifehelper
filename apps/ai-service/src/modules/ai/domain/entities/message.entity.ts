import type { UUID } from "@lifehelper/shared-types";
import { MessageRole } from "../enums/ai.enums";
import { AIDomainError } from "../errors/ai-domain.error";
export interface MessageProps {
  id: UUID;
  conversationId: UUID;
  role: MessageRole;
  content: string;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: Date;
}
export class Message {
  private constructor(private readonly props: MessageProps) {}
  static create(
    input: Pick<MessageProps, "id" | "conversationId" | "role" | "content"> &
      Partial<
        Pick<
          MessageProps,
          "provider" | "model" | "inputTokens" | "outputTokens" | "createdAt"
        >
      >,
  ): Message {
    if (!Object.values(MessageRole).includes(input.role))
      throw new AIDomainError("Unsupported message role");
    if (!input.content.trim())
      throw new AIDomainError("Message content is required");
    for (const count of [input.inputTokens, input.outputTokens])
      if (count != null && (!Number.isInteger(count) || count < 0))
        throw new AIDomainError("Token count must be a non-negative integer");
    const provider = Message.normalizeMetadata(input.provider, "Provider");
    const model = Message.normalizeMetadata(input.model, "Model");
    return new Message({
      ...input,
      provider,
      model,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      createdAt: input.createdAt ?? new Date(),
    });
  }
  static restore(p: MessageProps): Message {
    return new Message(p);
  }
  get state(): Readonly<MessageProps> {
    return this.props;
  }

  private static normalizeMetadata(
    value: string | null | undefined,
    field: string,
  ): string | null {
    if (value == null) return null;
    const normalized = value.trim();
    if (!normalized) throw new AIDomainError(`${field} cannot be empty`);
    if (normalized.length > 100)
      throw new AIDomainError(`${field} cannot exceed 100 characters`);
    return normalized;
  }
}
