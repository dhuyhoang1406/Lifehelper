import { PrismaService } from "../prisma.service";
import { Prisma } from "../../generated/client";
import type {
  DocumentRetrievalRepository,
  RetrievedChunk,
} from "../modules/document/application/ports/document-retrieval.repository";
export class PrismaDocumentRetrievalRepository implements DocumentRetrievalRepository {
  constructor(private readonly db: PrismaService) {}
  async ownsAll(userId: string, ids: readonly string[]): Promise<boolean> {
    return (
      (await this.db.document.count({
        where: { userId, id: { in: [...ids] }, deletedAt: null },
      })) === new Set(ids).size
    );
  }
  async chunks(
    userId: string,
    documentId: string,
    generation: number | undefined,
    after: number,
    limit: number,
    chunkId?: string,
  ): Promise<readonly RetrievedChunk[]> {
    return this.db.$queryRaw<RetrievedChunk[]>`
      SELECT d.id AS "documentId", c.id AS "chunkId", c.generation, c.chunk_index AS "chunkIndex",
        d.original_filename AS filename, left(c.content,32769) AS content,
        CASE WHEN c.locator_kind IS NULL THEN NULL ELSE json_build_object(
          'kind',c.locator_kind,'start',c.locator_start,'end',c.locator_end) END AS locator
      FROM documents d JOIN document_generations g ON g.document_id=d.id AND g.generation=d.active_generation
      JOIN document_chunks c ON c.document_id=d.id AND c.generation=g.generation
      WHERE d.id=${documentId}::uuid AND d.user_id=${userId}::uuid AND d.deleted_at IS NULL
        AND d.status='READY' AND g.status='COMPLETE' AND c.chunk_index>${after}
        ${generation === undefined ? Prisma.empty : Prisma.sql`AND g.generation=${generation}`}
        ${chunkId === undefined ? Prisma.empty : Prisma.sql`AND c.id=${chunkId}::uuid`}
      ORDER BY c.chunk_index LIMIT ${limit}`;
  }
}
