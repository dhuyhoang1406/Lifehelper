import type { DocumentCitation } from "../document-citation";
import type { UUID } from "@lifehelper/shared-types";
import type { JsonValue } from "@lifehelper/shared-types";
import { MessageRole } from "../enums/ai.enums";
import { AIDomainError } from "../errors/ai-domain.error";
export interface MessageProps {
  id: UUID;
  conversationId: UUID;
  role: MessageRole;
  content: string;
  citations?: readonly DocumentCitation[] | null;
  documentCoverage?: { partial: boolean; chunksRead: number } | null;
  toolPayload?: JsonValue | null;
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
          | "provider"
          | "model"
          | "inputTokens"
          | "outputTokens"
          | "createdAt"
          | "toolPayload"
          | "citations"
          | "documentCoverage"
        >
      >,
  ): Message {
    if (!Object.values(MessageRole).includes(input.role))
      throw new AIDomainError("Unsupported message role");
    const toolCallAssistant =
      input.role === MessageRole.ASSISTANT &&
      input.toolPayload !== null &&
      typeof input.toolPayload === "object" &&
      !Array.isArray(input.toolPayload) &&
      input.toolPayload?.kind === "tool_calls" &&
      Array.isArray(input.toolPayload.calls) &&
      input.toolPayload.calls.length > 0;
    if (!input.content.trim() && !toolCallAssistant)
      throw new AIDomainError("Message content is required");
    for (const count of [input.inputTokens, input.outputTokens])
      if (count != null && (!Number.isInteger(count) || count < 0))
        throw new AIDomainError("Token count must be a non-negative integer");
    if (input.citations != null) {
      const uuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (
        input.role !== MessageRole.ASSISTANT ||
        input.citations.length > 80 ||
        new Set(input.citations.map((c) => c.reference)).size !==
          input.citations.length ||
        input.citations.some(
          (c) =>
            !Number.isSafeInteger(c.reference) ||
            c.reference < 1 ||
            !uuid.test(c.documentId) ||
            !uuid.test(c.chunkId) ||
            !Number.isSafeInteger(c.generation) ||
            c.generation < 1 ||
            !c.filename ||
            c.filename.length > 255 ||
            !(
              (c.pageStart !== undefined &&
                c.pageEnd !== undefined &&
                c.lineStart === undefined &&
                c.lineEnd === undefined &&
                Number.isSafeInteger(c.pageStart) &&
                c.pageStart > 0 &&
                Number.isSafeInteger(c.pageEnd) &&
                c.pageEnd >= c.pageStart) ||
              (c.lineStart !== undefined &&
                c.lineEnd !== undefined &&
                c.pageStart === undefined &&
                c.pageEnd === undefined &&
                Number.isSafeInteger(c.lineStart) &&
                c.lineStart > 0 &&
                Number.isSafeInteger(c.lineEnd) &&
                c.lineEnd >= c.lineStart)
            ),
        )
      )
        throw new AIDomainError("Invalid document citations");
    }
    if (
      input.documentCoverage != null &&
      (input.role !== MessageRole.ASSISTANT ||
        typeof input.documentCoverage.partial !== "boolean" ||
        !Number.isSafeInteger(input.documentCoverage.chunksRead) ||
        input.documentCoverage.chunksRead < 0 ||
        input.documentCoverage.chunksRead > 80)
    )
      throw new AIDomainError("Invalid document coverage");
    const provider = Message.normalizeMetadata(input.provider, "Provider");
    const model = Message.normalizeMetadata(input.model, "Model");
    return new Message({
      ...input,
      provider,
      citations: input.citations ?? null,
      documentCoverage: input.documentCoverage ?? null,
      toolPayload: input.toolPayload ?? null,
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
