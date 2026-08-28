import type { UUID } from "@lifehelper/shared-types";
import { DocumentStatus } from "../enums/document-status.enum";
import { DocumentDomainError } from "../errors/document-domain.error";
export interface DocumentProps {
  id: UUID;
  userId: UUID;
  originalFilename: string;
  storageFilename: string;
  mimeType: string;
  sizeBytes: bigint;
  s3Bucket: string;
  s3Key: string;
  status: DocumentStatus;
  checksumSha256: string | null;
  processingError: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
export class Document {
  private constructor(private props: DocumentProps) {}
  static create(
    input: Pick<
      DocumentProps,
      | "id"
      | "userId"
      | "originalFilename"
      | "storageFilename"
      | "mimeType"
      | "sizeBytes"
      | "s3Bucket"
      | "s3Key"
    > &
      Partial<Pick<DocumentProps, "checksumSha256" | "createdAt">>,
  ): Document {
    if (input.sizeBytes < 0n)
      throw new DocumentDomainError("Document size cannot be negative");
    for (const value of [
      input.originalFilename,
      input.storageFilename,
      input.mimeType,
      input.s3Bucket,
      input.s3Key,
    ])
      if (!value.trim())
        throw new DocumentDomainError("Document storage metadata is required");
    const now = input.createdAt ?? new Date();
    return new Document({
      ...input,
      checksumSha256: input.checksumSha256 ?? null,
      status: DocumentStatus.PENDING_UPLOAD,
      processingError: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }
  static restore(p: DocumentProps): Document {
    return new Document(p);
  }
  get state(): Readonly<DocumentProps> {
    return this.props;
  }
  markUploaded(at = new Date()): void {
    if (this.props.status !== DocumentStatus.PENDING_UPLOAD)
      throw new DocumentDomainError(
        "Only pending-upload documents can be marked uploaded",
      );
    this.transition(DocumentStatus.UPLOADED, at);
  }
  startProcessing(at = new Date()): void {
    if (this.props.status !== DocumentStatus.UPLOADED)
      throw new DocumentDomainError("Only uploaded documents can process");
    this.transition(DocumentStatus.PROCESSING, at);
  }
  markReady(at = new Date()): void {
    if (this.props.status !== DocumentStatus.PROCESSING)
      throw new DocumentDomainError(
        "Only processing documents can become ready",
      );
    this.props.processingError = null;
    this.transition(DocumentStatus.READY, at);
  }
  markFailed(error: string, at = new Date()): void {
    this.props.processingError = error;
    this.transition(DocumentStatus.FAILED, at);
  }
  delete(at = new Date()): void {
    this.props.deletedAt = at;
    this.transition(DocumentStatus.DELETED, at);
  }
  private transition(status: DocumentStatus, at: Date): void {
    this.props.status = status;
    this.props.updatedAt = at;
  }
}
