import type { UUID } from "@lifehelper/shared-types";
import type { Conversation } from "../../modules/ai/domain/entities/conversation.entity";
import type { Message } from "../../modules/ai/domain/entities/message.entity";
import type { AIActionLog } from "../../modules/ai/domain/entities/ai-action-log.entity";
export interface ConversationRepository {
  findById(id: UUID): Promise<Conversation | null>;
  findByUserId(userId: UUID): Promise<Conversation[]>;
  save(entity: Conversation): Promise<void>;
}
export interface MessageRepository {
  findByConversationId(id: UUID): Promise<Message[]>;
  save(entity: Message): Promise<void>;
}
export interface AIActionLogRepository {
  findById(id: UUID): Promise<AIActionLog | null>;
  save(entity: AIActionLog): Promise<void>;
}
