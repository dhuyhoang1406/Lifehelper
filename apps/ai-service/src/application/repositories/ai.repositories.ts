import type { UUID } from "@lifehelper/shared-types";
import type { Conversation } from "../../modules/ai/domain/entities/conversation.entity";
import type { Message } from "../../modules/ai/domain/entities/message.entity";
import type { AIActionLog } from "../../modules/ai/domain/entities/ai-action-log.entity";

export interface AIPageQuery {
  page: number;
  limit: number;
}
export interface AIPage<T> extends AIPageQuery {
  items: T[];
  total: number;
}
export interface ConversationRepository {
  findByIdAndUserId(id: UUID, userId: UUID): Promise<Conversation | null>;
  findPageByUserId(
    userId: UUID,
    query: AIPageQuery,
  ): Promise<AIPage<Conversation>>;
  save(entity: Conversation): Promise<void>;
}
export interface MessageRepository {
  findPageByConversationAndUserId(
    conversationId: UUID,
    userId: UUID,
    query: AIPageQuery,
  ): Promise<AIPage<Message>>;
  save(entity: Message): Promise<void>;
}
export interface AIActionLogRepository {
  findByIdAndUserId(id: UUID, userId: UUID): Promise<AIActionLog | null>;
  findPageByUserId(
    userId: UUID,
    query: AIPageQuery,
  ): Promise<AIPage<AIActionLog>>;
  findPageByConversationAndUserId(
    conversationId: UUID,
    userId: UUID,
    query: AIPageQuery,
  ): Promise<AIPage<AIActionLog>>;
  save(entity: AIActionLog): Promise<void>;
}

export const CONVERSATION_REPOSITORY = Symbol("CONVERSATION_REPOSITORY");
export const MESSAGE_REPOSITORY = Symbol("MESSAGE_REPOSITORY");
export const AI_ACTION_LOG_REPOSITORY = Symbol("AI_ACTION_LOG_REPOSITORY");
