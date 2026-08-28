import type { UUID } from "@lifehelper/shared-types";
import type { Document } from "../../modules/document/domain/entities/document.entity";
import type { DocumentChunk } from "../../modules/document/domain/entities/document-chunk.entity";
export interface DocumentRepository {
  findById(id: UUID): Promise<Document | null>;
  findByUserId(userId: UUID): Promise<Document[]>;
  save(entity: Document): Promise<void>;
}
export interface DocumentChunkRepository {
  findByDocumentId(id: UUID): Promise<DocumentChunk[]>;
  save(entity: DocumentChunk): Promise<void>;
}
