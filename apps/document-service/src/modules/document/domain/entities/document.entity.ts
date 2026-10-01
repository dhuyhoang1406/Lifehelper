import type { DocumentGeneration } from "./document-generation.entity";
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
  processingGeneration: number;
  activeGeneration: number | null;
  revision: number;
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
    if (
      input.checksumSha256 != null &&
      !/^[a-f0-9]{64}$/.test(input.checksumSha256)
    )
      throw new DocumentDomainError("Invalid SHA-256 checksum");
    const now = input.createdAt ?? new Date();
    return new Document({
      ...input,
      checksumSha256: input.checksumSha256 ?? null,
      status: DocumentStatus.PENDING_UPLOAD,
      processingGeneration: 0,
      activeGeneration: null,
      revision: 0,
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
    if (
      ![
        DocumentStatus.UPLOADED,
        DocumentStatus.FAILED,
        DocumentStatus.READY,
      ].includes(this.props.status)
    )
      throw new DocumentDomainError(
        "Only uploaded, failed or ready documents can process",
      );
    this.props.processingGeneration += 1;
    this.props.processingError = null;
    this.transition(DocumentStatus.PROCESSING, at);
  }
  markReady(completed: DocumentGeneration, at = new Date()): void {
    if (this.props.status !== DocumentStatus.PROCESSING)
      throw new DocumentDomainError(
        "Only processing documents can become ready",
      );
    const generation = completed.state.generation;
    if (
      completed.state.documentId !== this.props.id ||
      completed.state.status !== "COMPLETE" ||
      generation !== this.props.processingGeneration ||
      generation < 1
    )
      throw new DocumentDomainError(
        "Ready generation must match current processing generation",
      );
    this.props.activeGeneration = generation;
    this.props.processingError = null;
    this.transition(DocumentStatus.READY, at);
  }
  markFailed(error: string, at = new Date()): void {
    if (
      ![DocumentStatus.UPLOADED, DocumentStatus.PROCESSING].includes(
        this.props.status,
      )
    )
      throw new DocumentDomainError(
        "Only uploaded or processing documents can fail",
      );
    if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(error))
      throw new DocumentDomainError("A safe error code is required");
    this.props.processingError = error;
    this.transition(DocumentStatus.FAILED, at);
  }
  delete(at = new Date()): void {
    if (this.props.status === DocumentStatus.DELETED) return;
    this.props.deletedAt = at;
    this.props.activeGeneration = null;
    this.transition(DocumentStatus.DELETED, at);
  }
  private transition(status: DocumentStatus, at: Date): void {
    this.props.status = status;
    this.props.updatedAt = at;
  }
}
