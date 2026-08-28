import type {
  Document as DocumentRecord,
  DocumentChunk as ChunkRecord,
} from "../../generated/client";
import { Prisma } from "../../generated/client";
import { PrismaService } from "../prisma.service";
import type {
  DocumentRepository,
  DocumentChunkRepository,
} from "../application/repositories/document.repositories";
import { Document } from "../modules/document/domain/entities/document.entity";
import { DocumentChunk } from "../modules/document/domain/entities/document-chunk.entity";
import { DocumentStatus } from "../modules/document/domain/enums/document-status.enum";
import type { JsonValue } from "@lifehelper/shared-types";
export const DocumentMapper = {
  toDomain: (r: DocumentRecord) =>
    Document.restore({ ...r, status: r.status as DocumentStatus }),
  toPersistence: (e: Document) => e.state,
};
export const DocumentChunkMapper = {
  toDomain: (r: ChunkRecord) =>
    DocumentChunk.restore({ ...r, metadata: r.metadata as JsonValue | null }),
  toPersistence: (e: DocumentChunk) => ({
    ...e.state,
    metadata:
      e.state.metadata === null
        ? Prisma.DbNull
        : (e.state.metadata as Prisma.InputJsonValue),
  }),
};
export class PrismaDocumentRepository implements DocumentRepository {
  constructor(private readonly db: PrismaService) {}
  async findById(id: string) {
    const r = await this.db.document.findUnique({ where: { id } });
    return r ? DocumentMapper.toDomain(r) : null;
  }
  async findByUserId(userId: string) {
    return (
      await this.db.document.findMany({
        where: { userId, deletedAt: null },
        orderBy: { createdAt: "desc" },
      })
    ).map(DocumentMapper.toDomain);
  }
  async save(e: Document) {
    const data = DocumentMapper.toPersistence(e);
    await this.db.document.upsert({
      where: { id: e.state.id },
      create: data,
      update: data,
    });
  }
}
export class PrismaDocumentChunkRepository implements DocumentChunkRepository {
  constructor(private readonly db: PrismaService) {}
  async findByDocumentId(documentId: string) {
    return (
      await this.db.documentChunk.findMany({
        where: { documentId },
        orderBy: { chunkIndex: "asc" },
      })
    ).map(DocumentChunkMapper.toDomain);
  }
  async save(e: DocumentChunk) {
    const data = DocumentChunkMapper.toPersistence(e);
    await this.db.documentChunk.upsert({
      where: { id: e.state.id },
      create: data,
      update: data,
    });
  }
}
