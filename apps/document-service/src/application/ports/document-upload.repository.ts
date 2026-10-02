import type { Document } from "../../modules/document/domain/entities/document.entity";
export interface DocumentUploadRepository {
  reserve(
    document: Document,
    maxDocuments: number,
    maxStorageBytes: bigint,
  ): Promise<void>;
  commitUpload(
    id: string,
    userId: string,
    revision: number,
    versionId: string,
    checksumSha256: string,
    at: Date,
  ): Promise<boolean>;
  deleteAndScheduleCleanup(
    id: string,
    userId: string,
    at: Date,
  ): Promise<boolean>;
}
export const DOCUMENT_UPLOAD_REPOSITORY = Symbol("DOCUMENT_UPLOAD_REPOSITORY");
