import type {
  DocumentVectorIndex,
  VectorQuery,
  VectorMatch,
} from "../modules/document/application/ports/document-vector-index.port";
import { validVector } from "../modules/document/application/services/embedding-validation";
import { DocumentProcessingFailure } from "../modules/document/domain/processing-policy";
import { PrismaService } from "../prisma.service";
export class PrismaDocumentVectorIndex implements DocumentVectorIndex {
  constructor(private readonly db: PrismaService) {}
  async search(query: VectorQuery): Promise<readonly VectorMatch[]> {
    if (
      !Number.isSafeInteger(query.topK) ||
      query.topK < 1 ||
      query.topK > 100 ||
      !validVector(query.vector, query.space.dimensions)
    )
      throw new DocumentProcessingFailure("DOCUMENT_EMBEDDING_RESULT_INVALID");
    const vector = `[${query.vector.join(",")}]`;
    // MATERIALIZED excludes incompatible dimensions/spaces before the cosine operator runs.
    return this.db.$queryRaw<VectorMatch[]>`
      WITH compatible AS MATERIALIZED (
        SELECT c.document_id,c.id AS chunk_id,c.chunk_index,e.embedding
        FROM documents d JOIN document_generations g ON g.document_id=d.id AND g.generation=d.active_generation
        JOIN document_chunks c ON c.document_id=d.id AND c.generation=g.generation
        JOIN document_embeddings e ON e.chunk_id=c.id
        WHERE d.user_id=${query.userId}::uuid AND d.deleted_at IS NULL AND d.status='READY' AND g.status='COMPLETE'
          AND g.embedding_model=${query.space.model} AND g.embedding_version=${query.space.version}
          AND g.embedding_dimensions=${query.space.dimensions}
          AND g.embedding_settings->>'inputPolicy'='plain-text-v1'
          AND e.embedding_model=${query.space.model}
          AND e.model_version=${query.space.version} AND e.dimensions=${query.space.dimensions}
          AND e.embedding IS NOT NULL
      ) SELECT document_id AS "documentId",chunk_id AS "chunkId",chunk_index AS "chunkIndex",
          embedding <=> ${vector}::vector AS distance FROM compatible
        ORDER BY distance,document_id,chunk_index LIMIT ${query.topK}`;
  }
}
