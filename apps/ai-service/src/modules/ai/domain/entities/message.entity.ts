import type { UUID } from "@lifehelper/shared-types";
import { MessageRole } from "../enums/ai.enums";
import { AIDomainError } from "../errors/ai-domain.error";
export interface MessageProps {
  id: UUID;
  conversationId: UUID;
  role: MessageRole;
  content: string;
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
          "model" | "inputTokens" | "outputTokens" | "createdAt"
        >
      >,
  ): Message {
    if (!input.content) throw new AIDomainError("Message content is required");
    for (const count of [input.inputTokens, input.outputTokens])
      if (count != null && count < 0)
        throw new AIDomainError("Token count cannot be negative");
    return new Message({
      ...input,
      model: input.model ?? null,
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
}
