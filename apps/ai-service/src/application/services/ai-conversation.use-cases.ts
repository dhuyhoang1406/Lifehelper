import { randomUUID } from "node:crypto";
import type { UUID } from "@lifehelper/shared-types";
import { AIApplicationError, AIErrorCode } from "../errors/ai.errors";
import type {
  AIPageQuery,
  ConversationRepository,
  MessageRepository,
} from "../repositories/ai.repositories";
import type { AIProviderRouter } from "./ai-provider.router";
import { Conversation } from "../../modules/ai/domain/entities/conversation.entity";
import { Message } from "../../modules/ai/domain/entities/message.entity";
import { MessageRole } from "../../modules/ai/domain/enums/ai.enums";
import { decodeMessageCursor, encodeMessageCursor } from "./ai-message-cursor";

const conversationNotFound = () =>
  new AIApplicationError(
    AIErrorCode.AI_CONVERSATION_NOT_FOUND,
    "Conversation not found",
    404,
  );

export class AIConversationUseCases {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly provider: Pick<AIProviderRouter, "generate">,
    private readonly maxContextMessages: number,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => UUID = randomUUID,
  ) {}

  async chat(userId: UUID, prompt: string, conversationId?: UUID) {
    let conversation: Conversation;
    if (conversationId) {
      conversation = await this.findOwnedConversation(conversationId, userId);
    } else {
      conversation = Conversation.create({
        id: this.newId(),
        userId,
        createdAt: this.now(),
      });
      await this.conversations.save(conversation);
    }

    const userCreatedAt = await this.conversations.nextMessageAt(
      conversation.state.id,
      userId,
    );
    if (!userCreatedAt) throw conversationNotFound();
    const userMessage = Message.create({
      id: this.newId(),
      conversationId: conversation.state.id,
      role: MessageRole.USER,
      content: prompt,
      createdAt: userCreatedAt,
    });
    await this.messages.save(userMessage);

    const context = await this.messages.findRecentByConversationAndUserId(
      conversation.state.id,
      userId,
      this.maxContextMessages,
      userCreatedAt,
    );
    const response = await this.provider.generate({
      messages: context.map(({ state }) => ({
        role: state.role,
        content: state.content,
      })),
    });
    if (response.toolCalls.length || !response.content?.trim())
      throw new AIApplicationError(
        AIErrorCode.AI_PROVIDER_INVALID_RESPONSE,
        "AI provider did not return a text response",
        502,
      );

    // The conditional timestamp update also checks ownership and soft deletion.
    const assistantCreatedAt = await this.conversations.nextMessageAt(
      conversation.state.id,
      userId,
    );
    if (!assistantCreatedAt) throw conversationNotFound();
    const assistantMessage = Message.create({
      id: this.newId(),
      conversationId: conversation.state.id,
      role: MessageRole.ASSISTANT,
      content: response.content,
      provider: response.metadata.provider,
      model: response.metadata.model,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      createdAt: assistantCreatedAt,
    });
    await this.messages.save(assistantMessage);
    return {
      conversationId: conversation.state.id,
      userMessageId: userMessage.state.id,
      assistantMessageId: assistantMessage.state.id,
      content: assistantMessage.state.content,
      usage: response.usage,
      metadata: response.metadata,
      createdAt: assistantMessage.state.createdAt,
    };
  }

  async list(userId: UUID, query: AIPageQuery) {
    const page = await this.conversations.findPageByUserId(userId, query);
    return { ...page, items: page.items.map((item) => item.state) };
  }

  async get(
    userId: UUID,
    conversationId: UUID,
    query: { limit: number; cursor?: string },
  ) {
    const conversation = await this.findOwnedConversation(conversationId, userId);
    const before = query.cursor
      ? decodeMessageCursor(query.cursor, conversationId)
      : null;
    const rows = await this.messages.findBeforeByConversationAndUserId(
      conversationId,
      userId,
      before,
      query.limit + 1,
    );
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const oldest = page.at(-1)?.state;
    return {
      conversation: conversation.state,
      messages: {
        items: page.reverse().map((item) => item.state),
        limit: query.limit,
        hasMore,
        nextCursor: hasMore && oldest
          ? encodeMessageCursor(conversationId, oldest)
          : null,
      },
    };
  }

  async delete(userId: UUID, conversationId: UUID): Promise<void> {
    const conversation = await this.findOwnedConversation(conversationId, userId);
    conversation.delete(this.now());
    await this.conversations.save(conversation);
  }

  private async findOwnedConversation(id: UUID, userId: UUID) {
    const conversation = await this.conversations.findByIdAndUserId(id, userId);
    if (!conversation) throw conversationNotFound();
    return conversation;
  }
}
