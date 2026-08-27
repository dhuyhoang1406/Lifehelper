import type { JsonValue, UUID } from "@lifehelper/shared-types";
import { DocumentDomainError } from "../errors/document-domain.error";
export interface DocumentChunkProps {
  id: UUID;
  documentId: UUID;
  chunkIndex: number;
  content: string;
  tokenCount: number | null;
  metadata: JsonValue | null;
  createdAt: Date;
}
export class DocumentChunk {
  private constructor(private readonly props: DocumentChunkProps) {}
  static create(
    input: Pick<
      DocumentChunkProps,
      "id" | "documentId" | "chunkIndex" | "content"
    > &
      Partial<
        Pick<DocumentChunkProps, "tokenCount" | "metadata" | "createdAt">
      >,
  ): DocumentChunk {
    if (input.chunkIndex < 0 || !Number.isInteger(input.chunkIndex))
      throw new DocumentDomainError(
        "Chunk index must be a non-negative integer",
      );
    if (!input.content)
      throw new DocumentDomainError("Chunk content is required");
    if (input.tokenCount != null && input.tokenCount < 0)
      throw new DocumentDomainError("Token count cannot be negative");
    return new DocumentChunk({
      ...input,
      tokenCount: input.tokenCount ?? null,
      metadata: input.metadata ?? null,
      createdAt: input.createdAt ?? new Date(),
    });
  }
  static restore(p: DocumentChunkProps): DocumentChunk {
    return new DocumentChunk(p);
  }
  get state(): Readonly<DocumentChunkProps> {
    return this.props;
  }
}
