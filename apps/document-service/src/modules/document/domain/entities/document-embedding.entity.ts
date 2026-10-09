import type { UUID } from "@lifehelper/shared-types";
import { DocumentDomainError } from "../errors/document-domain.error";
export interface DocumentEmbeddingProps {
  id: UUID;
  chunkId: UUID;
  embeddingModel: string;
  embedding: readonly number[];
  modelVersion: string;
  dimensions: number;
  createdAt: Date;
}
export class DocumentEmbedding {
  private constructor(private readonly props: DocumentEmbeddingProps) {}
  static create(
    input: Omit<
      DocumentEmbeddingProps,
      "createdAt" | "modelVersion" | "dimensions"
    > &
      Partial<
        Pick<
          DocumentEmbeddingProps,
          "createdAt" | "modelVersion" | "dimensions"
        >
      >,
  ): DocumentEmbedding {
    if (
      !input.embeddingModel.trim() ||
      input.embedding.length === 0 ||
      input.embedding.some(
        (v) => !Number.isFinite(v) || !Number.isFinite(Math.fround(v)),
      ) ||
      !input.embedding.some((v) => Math.fround(v) !== 0)
    )
      throw new DocumentDomainError(
        "Embedding model and finite vector are required",
      );
    const dimensions = input.dimensions ?? input.embedding.length;
    const modelVersion = input.modelVersion ?? "legacy";
    if (
      !modelVersion.trim() ||
      modelVersion.length > 100 ||
      input.embeddingModel.length > 100 ||
      !Number.isSafeInteger(dimensions) ||
      dimensions < 1 ||
      dimensions !== input.embedding.length
    )
      throw new DocumentDomainError(
        "Invalid embedding dimensions or model version",
      );
    return new DocumentEmbedding({
      ...input,
      embedding: [...input.embedding],
      dimensions,
      modelVersion,
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
