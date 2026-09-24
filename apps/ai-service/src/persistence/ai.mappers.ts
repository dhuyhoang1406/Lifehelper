import type {
  AIActionLog as AIActionLogRecord,
  Conversation as ConversationRecord,
  Message as MessageRecord,
} from "../../generated/client";
import { Prisma } from "../../generated/client";
import type { JsonValue } from "@lifehelper/shared-types";
import { Conversation } from "../modules/ai/domain/entities/conversation.entity";
import { Message } from "../modules/ai/domain/entities/message.entity";
import { AIActionLog } from "../modules/ai/domain/entities/ai-action-log.entity";
import {
  AIActionStatus,
  MessageRole,
} from "../modules/ai/domain/enums/ai.enums";

export const ConversationMapper = {
  toDomain: (record: ConversationRecord) => Conversation.restore(record),
  toPersistence: (entity: Conversation) => entity.state,
};

export const MessageMapper = {
  toDomain: (record: MessageRecord) =>
    Message.restore({ ...record, role: record.role as MessageRole }),
  toPersistence: (entity: Message) => entity.state,
};

export const AIActionLogMapper = {
  toDomain: (record: AIActionLogRecord) =>
    AIActionLog.restore({
      ...record,
      status: record.status as AIActionStatus,
      inputPayload: record.inputPayload as JsonValue,
      outputPayload: record.outputPayload as JsonValue | null,
    }),
  toPersistence: (entity: AIActionLog) => ({
    ...entity.state,
    inputPayload:
      entity.state.inputPayload === null
        ? Prisma.JsonNull
        : (entity.state.inputPayload as Prisma.InputJsonValue),
    outputPayload:
      entity.state.outputPayload === null
        ? Prisma.DbNull
        : (entity.state.outputPayload as Prisma.InputJsonValue),
  }),
};
