import type { Prisma } from "../../generated/client";
import type {
  AIActionLogRepository,
  AIPage,
  AIPageQuery,
  ConversationRepository,
  MessageRepository,
} from "../application/repositories/ai.repositories";
import type { Conversation } from "../modules/ai/domain/entities/conversation.entity";
import type { Message } from "../modules/ai/domain/entities/message.entity";
import type { AIActionLog } from "../modules/ai/domain/entities/ai-action-log.entity";
import {
  AIActionLogMapper,
  ConversationMapper,
  MessageMapper,
} from "./ai.mappers";

type AIDatabase = Pick<
  Prisma.TransactionClient,
  "conversation" | "message" | "aIActionLog" | "$queryRaw"
>;

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
