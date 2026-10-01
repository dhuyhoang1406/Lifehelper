import { DocumentDomainError } from "../errors/document-domain.error";

export type GenerationStatus = "PROCESSING" | "COMPLETE" | "FAILED";
export interface DocumentGenerationProps {
  documentId: string;
  generation: number;
  status: GenerationStatus;
  chunkCount: number | null;
  createdAt: Date;
  completedAt: Date | null;
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
    });
  }
  static restore(props: DocumentGenerationProps) {
    return new DocumentGeneration(props);
  }
  get state(): Readonly<DocumentGenerationProps> {
    return this.props;
  }
  complete(chunkCount: number, at = new Date()) {
    if (
      this.props.status !== "PROCESSING" ||
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
    if (this.props.status !== "PROCESSING")
      throw new DocumentDomainError("Only processing generations can fail");
    this.props.status = "FAILED";
  }
}
