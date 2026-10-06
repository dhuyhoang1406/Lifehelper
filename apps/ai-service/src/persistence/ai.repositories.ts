import type { Prisma } from "../../generated/client";
import type { OutboxEventInput } from "@lifehelper/shared-types";
import { PrismaService } from "../prisma.service";
import { aiOutboxEvent } from "../modules/ai/application/services/ai-audit-events";
import type {
  AIActionLogRepository,
  AIOutboxRepository,
  AIPage,
  AIPageQuery,
  ConversationRepository,
  MessageRepository,
} from "../modules/ai/application/repositories/ai.repositories";
import type { Conversation } from "../modules/ai/domain/entities/conversation.entity";
import type { Message } from "../modules/ai/domain/entities/message.entity";
import type { AIActionLog } from "../modules/ai/domain/entities/ai-action-log.entity";
import {
  AIActionLogMapper,
  ConversationMapper,
  MessageMapper,
} from "./ai.mappers";

type AIDatabase = PrismaService;

function outboxData(event: OutboxEventInput) {
  return { ...event, payload: event.payload as Prisma.InputJsonValue };
}

const pageOffset = ({ page, limit }: AIPageQuery): number => (page - 1) * limit;

export class PrismaConversationRepository implements ConversationRepository {
  constructor(private readonly db: AIDatabase) {}

  async findByIdAndUserId(id: string, userId: string) {
    const record = await this.db.conversation.findFirst({
      where: { id, userId, deletedAt: null },
    });
    return record ? ConversationMapper.toDomain(record) : null;
  }

  async nextMessageAt(id: string, userId: string): Promise<Date | null> {
    const rows = await this.db.$queryRaw<Array<{ updatedAt: Date }>>`
      UPDATE conversations
      SET updated_at = GREATEST(
        updated_at + INTERVAL '1 millisecond',
        clock_timestamp()
      )
      WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL
      RETURNING updated_at AS "updatedAt"
    `;
    return rows[0]?.updatedAt ?? null;
  }

  async findPageByUserId(
    userId: string,
    query: AIPageQuery,
  ): Promise<AIPage<Conversation>> {
    const where = { userId, deletedAt: null };
    const [records, total] = await Promise.all([
      this.db.conversation.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: pageOffset(query),
        take: query.limit,
      }),
      this.db.conversation.count({ where }),
    ]);
    return {
      items: records.map(ConversationMapper.toDomain),
      total,
      ...query,
    };
  }

  async save(entity: Conversation): Promise<void> {
    const data = ConversationMapper.toPersistence(entity);
    await this.db.conversation.upsert({
      where: { id: entity.state.id },
      create: data,
      update: {
        title: data.title,
        updatedAt: data.updatedAt,
        deletedAt: data.deletedAt,
      },
    });
  }
}

export class PrismaMessageRepository implements MessageRepository {
  constructor(private readonly db: AIDatabase) {}

  async findRecentByConversationAndUserId(
    conversationId: string,
    userId: string,
    limit: number,
    through?: Date,
  ): Promise<Message[]> {
    const records = await this.db.message.findMany({
      where: {
        conversationId,
        conversation: { userId, deletedAt: null },
        ...(through ? { createdAt: { lte: through } } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return records.reverse().map(MessageMapper.toDomain);
  }

  async findBeforeByConversationAndUserId(
    conversationId: string,
    userId: string,
    before: { createdAt: Date; id: string } | null,
    limit: number,
  ): Promise<Message[]> {
    const where: Prisma.MessageWhereInput = {
      conversationId,
      conversation: { userId, deletedAt: null },
      ...(before
        ? {
            OR: [
              { createdAt: { lt: before.createdAt } },
              { createdAt: before.createdAt, id: { lt: before.id } },
            ],
          }
        : {}),
    };
    const records = await this.db.message.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return records.map(MessageMapper.toDomain);
  }

  async save(entity: Message): Promise<void> {
    const data = MessageMapper.toPersistence(entity);
    await this.db.message.create({ data });
  }

  async saveWithEvent(entity: Message, event: OutboxEventInput): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.message.create({ data: MessageMapper.toPersistence(entity) });
      await tx.outboxEvent.create({ data: outboxData(event) });
    });
  }

  async saveMany(entities: readonly Message[]): Promise<void> {
    await this.db.message.createMany({
      data: entities.map(MessageMapper.toPersistence),
    });
  }
}

export class PrismaAIActionLogRepository implements AIActionLogRepository {
  constructor(private readonly db: AIDatabase) {}

  async findByIdAndUserId(id: string, userId: string) {
    const record = await this.db.aIActionLog.findFirst({
      where: { id, userId },
    });
    return record ? AIActionLogMapper.toDomain(record) : null;
  }

  async claim(
    id: string,
    userId: string,
    payloadHash: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.db.aIActionLog.updateMany({
      where: {
        id,
        userId,
        payloadHash,
        status: "REQUESTED",
        expiresAt: { gt: now },
      },
      data: { status: "EXECUTING" },
    });
    return result.count === 1;
  }

  async rejectIfRequested(
    id: string,
    userId: string,
    payloadHash: string,
    reason: string,
    event?: OutboxEventInput,
  ): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const result = await tx.aIActionLog.updateMany({
        where: { id, userId, payloadHash, status: "REQUESTED" },
        data: { status: "REJECTED", errorCode: reason },
      });
      if (result.count === 1 && event)
        await tx.outboxEvent.create({ data: outboxData(event) });
      return result.count === 1;
    });
  }

  async recoverStale(now: Date, interruptedBefore: Date): Promise<void> {
    type Recovered = {
      id: string;
      toolName: string;
      correlationId: string | null;
      status: "REJECTED" | "FAILED";
      errorCode: string;
    };
    await this.db.$transaction(async (tx) => {
      const expired = await tx.$queryRaw<Recovered[]>`
        UPDATE ai_action_logs
        SET status = 'REJECTED', error_code = 'ACTION_EXPIRED'
        WHERE status = 'REQUESTED' AND expires_at <= ${now}
        RETURNING id, tool_name AS "toolName", correlation_id AS "correlationId",
          status::text AS status, error_code AS "errorCode"
      `;
      const interrupted = await tx.$queryRaw<Recovered[]>`
        UPDATE ai_action_logs
        SET status = 'FAILED', error_code = 'AI_ACTION_OUTCOME_UNKNOWN'
        WHERE status = 'EXECUTING' AND expires_at <= ${interruptedBefore}
        RETURNING id, tool_name AS "toolName", correlation_id AS "correlationId",
          status::text AS status, error_code AS "errorCode"
      `;
      const events = [...expired, ...interrupted].map((row) =>
        outboxData(
          aiOutboxEvent({
            type: "ai.failed",
            aggregateType: "action",
            aggregateId: row.id,
            correlationId: row.correlationId ?? row.id,
            occurredAt: now,
            payload: {
              actionId: row.id,
              toolName: row.toolName,
              status: row.status,
              errorCode: row.errorCode,
            },
          }),
        ),
      );
      if (events.length) await tx.outboxEvent.createMany({ data: events });
    });
  }

  async finalize(entity: AIActionLog, event?: OutboxEventInput): Promise<void> {
    const data = AIActionLogMapper.toPersistence(entity);
    await this.db.$transaction(async (tx) => {
      const result = await tx.aIActionLog.updateMany({
        where: {
          id: entity.state.id,
          userId: entity.state.userId,
          status: "EXECUTING",
        },
        data: {
          status: data.status,
          outputPayload: data.outputPayload,
          errorCode: data.errorCode,
          durationMs: data.durationMs,
        },
      });
      if (result.count !== 1)
        throw new Error("Action state changed during execution");
      if (event) await tx.outboxEvent.create({ data: outboxData(event) });
    });
  }

  async findPageByUserId(
    userId: string,
    query: AIPageQuery,
  ): Promise<AIPage<AIActionLog>> {
    return this.findPage({ userId }, query);
  }

  async findPageByConversationAndUserId(
    conversationId: string,
    userId: string,
    query: AIPageQuery,
  ): Promise<AIPage<AIActionLog>> {
    return this.findPage({ conversationId, userId }, query);
  }

  async save(entity: AIActionLog): Promise<void> {
    const data = AIActionLogMapper.toPersistence(entity);
    await this.db.aIActionLog.upsert({
      where: { id: entity.state.id },
      create: data,
      update: {
        outputPayload: data.outputPayload,
        status: data.status,
        errorCode: data.errorCode,
        durationMs: data.durationMs,
      },
    });
  }

  async saveWithEvent(
    entity: AIActionLog,
    event: OutboxEventInput,
  ): Promise<void> {
    const data = AIActionLogMapper.toPersistence(entity);
    await this.db.$transaction(async (tx) => {
      await tx.aIActionLog.create({ data });
      await tx.outboxEvent.create({ data: outboxData(event) });
    });
  }

  private async findPage(
    where: { userId: string; conversationId?: string },
    query: AIPageQuery,
  ): Promise<AIPage<AIActionLog>> {
    const [records, total] = await Promise.all([
      this.db.aIActionLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: pageOffset(query),
        take: query.limit,
      }),
      this.db.aIActionLog.count({ where }),
    ]);
    return {
      items: records.map(AIActionLogMapper.toDomain),
      total,
      ...query,
    };
  }
}

export class PrismaAIOutboxRepository implements AIOutboxRepository {
  constructor(private readonly db: PrismaService) {}

  async save(event: OutboxEventInput): Promise<void> {
    await this.db.outboxEvent.create({ data: outboxData(event) });
  }
}
