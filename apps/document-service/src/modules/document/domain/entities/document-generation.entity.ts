import { DocumentDomainError } from "../errors/document-domain.error";

export type GenerationStatus =
  "PROCESSING" | "EXTRACTED" | "COMPLETE" | "FAILED";
export interface DocumentGenerationProps {
  documentId: string;
  generation: number;
  status: GenerationStatus;
  chunkCount: number | null;
  createdAt: Date;
  completedAt: Date | null;
  processingVersion: string | null;
  sourceChecksumSha256: string | null;
  sourceVersionId: string | null;
  extractedAt: Date | null;
}
export class DocumentGeneration {
  private constructor(private readonly props: DocumentGenerationProps) {}
  static create(documentId: string, generation: number, at = new Date()) {
    if (!Number.isSafeInteger(generation) || generation < 1)
      throw new DocumentDomainError("Generation must be a positive integer");
    return new DocumentGeneration({
      documentId,
      generation,
      status: "PROCESSING",
      chunkCount: null,
      createdAt: at,
      completedAt: null,
      processingVersion: null,
      sourceChecksumSha256: null,
      sourceVersionId: null,
      extractedAt: null,
    });
  }
  static restore(props: DocumentGenerationProps) {
    return new DocumentGeneration(props);
  }
  get state(): Readonly<DocumentGenerationProps> {
    return this.props;
  }
  extract(
    chunkCount: number,
    identity: {
      processingVersion: string;
      sourceChecksumSha256: string;
      sourceVersionId: string;
    },
    at = new Date(),
  ) {
    if (
      this.props.status !== "PROCESSING" ||
      !Number.isSafeInteger(chunkCount) ||
      chunkCount < 1 ||
      !identity.processingVersion.trim() ||
      identity.processingVersion.length > 100 ||
      !/^[0-9a-f]{64}$/.test(identity.sourceChecksumSha256) ||
      !identity.sourceVersionId.trim() ||
      identity.sourceVersionId.length > 1024
    )
      throw new DocumentDomainError(
        "Only processing generations with verified chunks can be extracted",
      );
    Object.assign(this.props, {
      processingVersion: identity.processingVersion,
      sourceChecksumSha256: identity.sourceChecksumSha256,
      sourceVersionId: identity.sourceVersionId,
      status: "EXTRACTED",
      chunkCount,
      extractedAt: at,
    });
  }
  complete(chunkCount: number, at = new Date()) {
    if (
      !["PROCESSING", "EXTRACTED"].includes(this.props.status) ||
      !Number.isSafeInteger(chunkCount) ||
      chunkCount < 1
    )
      throw new DocumentDomainError(
        "Only processing generations with chunks can complete",
      );
    this.props.status = "COMPLETE";
    this.props.chunkCount = chunkCount;
    this.props.completedAt = at;
  }
  fail() {
    if (!["PROCESSING", "EXTRACTED"].includes(this.props.status))
      throw new DocumentDomainError("Only processing generations can fail");
    this.props.status = "FAILED";
  }
}
