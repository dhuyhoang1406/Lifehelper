import type { JsonValue, UUID } from "@lifehelper/shared-types";
import { DocumentDomainError } from "../errors/document-domain.error";
export type SourceLocator = {
  kind: "PAGE" | "LINE";
  start: number;
  end: number;
};
export interface DocumentChunkProps {
  id: UUID;
  documentId: UUID;
  generation: number;
  locator: SourceLocator | null;
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
        Pick<
          DocumentChunkProps,
          "tokenCount" | "metadata" | "createdAt" | "generation" | "locator"
        >
      >,
  ): DocumentChunk {
    if (input.chunkIndex < 0 || !Number.isInteger(input.chunkIndex))
      throw new DocumentDomainError(
        "Chunk index must be a non-negative integer",
      );
    if (!input.content.trim())
      throw new DocumentDomainError("Chunk content is required");
    if (
      input.tokenCount != null &&
      (!Number.isSafeInteger(input.tokenCount) || input.tokenCount < 0)
    )
      throw new DocumentDomainError("Token count cannot be negative");
    const generation = input.generation ?? 1;
    if (!Number.isSafeInteger(generation) || generation < 1)
      throw new DocumentDomainError("Generation must be a positive integer");
    const locator = input.locator ?? null;
    if (
      locator &&
      (!["PAGE", "LINE"].includes(locator.kind) ||
        !Number.isSafeInteger(locator.start) ||
        !Number.isSafeInteger(locator.end) ||
        locator.start < 1 ||
        locator.end < locator.start)
    )
      throw new DocumentDomainError("Invalid source locator");
    return new DocumentChunk({
      ...input,
      generation,
      locator,
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
