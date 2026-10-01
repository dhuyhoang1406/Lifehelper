import { DocumentDomainError } from "../errors/document-domain.error";

export type ProcessingJobStatus =
  "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export interface DocumentProcessingJobProps {
  id: string;
  documentId: string;
  generation: number;
  status: ProcessingJobStatus;
  attemptCount: number;
  nextAttemptAt: Date;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export class DocumentProcessingJob {
  private constructor(private readonly props: DocumentProcessingJobProps) {}
  static create(
    id: string,
    documentId: string,
    generation: number,
    at = new Date(),
  ) {
    if (!Number.isSafeInteger(generation) || generation < 1)
      throw new DocumentDomainError("Invalid job generation");
    return new DocumentProcessingJob({
      id,
      documentId,
      generation,
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: at,
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode: null,
      createdAt: at,
      updatedAt: at,
    });
  }
  static restore(props: DocumentProcessingJobProps) {
    return new DocumentProcessingJob(props);
  }
  get state(): Readonly<DocumentProcessingJobProps> {
    return this.props;
  }
  claim(owner: string, expiresAt: Date, at = new Date()) {
    if (
      this.props.status !== "PENDING" ||
      this.props.nextAttemptAt > at ||
      !owner.trim() ||
      owner.length > 128 ||
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt <= at
    )
      throw new DocumentDomainError("Invalid job claim");
    this.props.status = "RUNNING";
    this.props.attemptCount += 1;
    this.props.leaseOwner = owner;
    this.props.leaseExpiresAt = expiresAt;
    this.props.updatedAt = at;
  }
  finish(
    status: "SUCCEEDED" | "FAILED",
    errorCode: string | null = null,
    at = new Date(),
  ) {
    if (
      this.props.status !== "RUNNING" ||
      (status === "FAILED" && !errorCode) ||
      (status === "SUCCEEDED" && errorCode !== null) ||
      (errorCode !== null && !/^[A-Z][A-Z0-9_]{0,99}$/.test(errorCode))
    )
      throw new DocumentDomainError("Invalid job completion");
    this.props.status = status;
    this.props.errorCode = errorCode;
    this.props.leaseOwner = null;
    this.props.leaseExpiresAt = null;
    this.props.updatedAt = at;
  }
}
