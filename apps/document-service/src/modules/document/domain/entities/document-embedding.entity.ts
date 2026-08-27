import type { UUID } from "@lifehelper/shared-types";
import { DocumentDomainError } from "../errors/document-domain.error";
export interface DocumentEmbeddingProps {
  id: UUID;
  chunkId: UUID;
  embeddingModel: string;
  embedding: readonly number[];
  createdAt: Date;
}
export class DocumentEmbedding {
  private constructor(private readonly props: DocumentEmbeddingProps) {}
  static create(
    input: Omit<DocumentEmbeddingProps, "createdAt"> &
      Partial<Pick<DocumentEmbeddingProps, "createdAt">>,
  ): DocumentEmbedding {
    if (
      !input.embeddingModel.trim() ||
      input.embedding.length === 0 ||
      input.embedding.some((v) => !Number.isFinite(v))
    )
      throw new DocumentDomainError(
        "Embedding model and finite vector are required",
      );
    return new DocumentEmbedding({
      ...input,
      embedding: [...input.embedding],
      createdAt: input.createdAt ?? new Date(),
    });
  }
  static restore(p: DocumentEmbeddingProps): DocumentEmbedding {
    return new DocumentEmbedding(p);
  }
  get state(): Readonly<DocumentEmbeddingProps> {
    return this.props;
  }
}
