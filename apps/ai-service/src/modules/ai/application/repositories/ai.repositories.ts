import type { UUID, OutboxEventInput } from "@lifehelper/shared-types";
import type { Conversation } from "../../domain/entities/conversation.entity";
import type { Message } from "../../domain/entities/message.entity";
import type { AIActionLog } from "../../domain/entities/ai-action-log.entity";

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
  nextMessageAt(id: UUID, userId: UUID): Promise<Date | null>;
  findPageByUserId(
    userId: UUID,
    query: AIPageQuery,
  ): Promise<AIPage<Conversation>>;
  save(entity: Conversation): Promise<void>;
}
export interface MessageRepository {
  findRecentByConversationAndUserId(
    conversationId: UUID,
    userId: UUID,
    limit: number,
    through?: Date,
  ): Promise<Message[]>;
  findBeforeByConversationAndUserId(
    conversationId: UUID,
    userId: UUID,
    before: { createdAt: Date; id: UUID } | null,
    limit: number,
  ): Promise<Message[]>;
  save(entity: Message): Promise<void>;
  saveWithEvent(entity: Message, event: OutboxEventInput): Promise<void>;
  saveMany(entities: readonly Message[]): Promise<void>;
}
export interface AIActionLogRepository {
  findByIdAndUserId(id: UUID, userId: UUID): Promise<AIActionLog | null>;
  claim(
    id: UUID,
    userId: UUID,
    payloadHash: string,
    now: Date,
  ): Promise<boolean>;
  rejectIfRequested(
    id: UUID,
    userId: UUID,
    payloadHash: string,
    reason: string,
    event?: OutboxEventInput,
  ): Promise<boolean>;
  recoverStale(now: Date, interruptedBefore: Date): Promise<void>;
  finalize(entity: AIActionLog, event?: OutboxEventInput): Promise<void>;
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
  saveWithEvent(entity: AIActionLog, event: OutboxEventInput): Promise<void>;
}

export interface AIOutboxRepository {
  save(event: OutboxEventInput): Promise<void>;
}

export const AI_OUTBOX_REPOSITORY = Symbol("AI_OUTBOX_REPOSITORY");
export const CONVERSATION_REPOSITORY = Symbol("CONVERSATION_REPOSITORY");
export const MESSAGE_REPOSITORY = Symbol("MESSAGE_REPOSITORY");
export const AI_ACTION_LOG_REPOSITORY = Symbol("AI_ACTION_LOG_REPOSITORY");
