import type {
  Conversation as ConversationRecord,
  Message as MessageRecord,
  AIActionLog as ActionRecord,
} from "../../generated/client";
import { Prisma } from "../../generated/client";
import { PrismaService } from "../prisma.service";
import type {
  ConversationRepository,
  MessageRepository,
  AIActionLogRepository,
} from "../application/repositories/ai.repositories";
import { Conversation } from "../modules/ai/domain/entities/conversation.entity";
import { Message } from "../modules/ai/domain/entities/message.entity";
import { AIActionLog } from "../modules/ai/domain/entities/ai-action-log.entity";
import {
  AIActionStatus,
  MessageRole,
} from "../modules/ai/domain/enums/ai.enums";
import type { JsonValue } from "@lifehelper/shared-types";
export const ConversationMapper = {
  toDomain: (r: ConversationRecord) => Conversation.restore(r),
  toPersistence: (e: Conversation) => e.state,
};
export const MessageMapper = {
  toDomain: (r: MessageRecord) =>
    Message.restore({ ...r, role: r.role as MessageRole }),
  toPersistence: (e: Message) => e.state,
};
export const AIActionLogMapper = {
  toDomain: (r: ActionRecord) =>
    AIActionLog.restore({
      ...r,
      status: r.status as AIActionStatus,
      inputPayload: r.inputPayload as JsonValue,
      outputPayload: r.outputPayload as JsonValue | null,
    }),
  toPersistence: (e: AIActionLog) => ({
    ...e.state,
    inputPayload:
      e.state.inputPayload === null
        ? Prisma.JsonNull
        : (e.state.inputPayload as Prisma.InputJsonValue),
    outputPayload:
      e.state.outputPayload === null
        ? Prisma.DbNull
        : (e.state.outputPayload as Prisma.InputJsonValue),
  }),
};
export class PrismaConversationRepository implements ConversationRepository {
  constructor(private readonly db: PrismaService) {}
  async findById(id: string) {
    const r = await this.db.conversation.findUnique({ where: { id } });
    return r ? ConversationMapper.toDomain(r) : null;
  }
  async findByUserId(userId: string) {
    return (
      await this.db.conversation.findMany({
        where: { userId, deletedAt: null },
        orderBy: { updatedAt: "desc" },
      })
    ).map(ConversationMapper.toDomain);
  }
  async save(e: Conversation) {
    const data = ConversationMapper.toPersistence(e);
    await this.db.conversation.upsert({
      where: { id: e.state.id },
      create: data,
      update: data,
    });
  }
}
export class PrismaMessageRepository implements MessageRepository {
  constructor(private readonly db: PrismaService) {}
  async findByConversationId(conversationId: string) {
    return (
      await this.db.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: "asc" },
      })
    ).map(MessageMapper.toDomain);
  }
  async save(e: Message) {
    const data = MessageMapper.toPersistence(e);
    await this.db.message.upsert({
      where: { id: e.state.id },
      create: data,
      update: data,
    });
  }
}
export class PrismaAIActionLogRepository implements AIActionLogRepository {
  constructor(private readonly db: PrismaService) {}
  async findById(id: string) {
    const r = await this.db.aIActionLog.findUnique({ where: { id } });
    return r ? AIActionLogMapper.toDomain(r) : null;
  }
  async save(e: AIActionLog) {
    const data = AIActionLogMapper.toPersistence(e);
    await this.db.aIActionLog.upsert({
      where: { id: e.state.id },
      create: data,
      update: data,
    });
  }
}
