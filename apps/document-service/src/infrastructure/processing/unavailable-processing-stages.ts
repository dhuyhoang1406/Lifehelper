import type { DocumentProcessingStages } from "../../application/ports/document-processing.port";
import { DocumentProcessingFailure } from "../../modules/document/domain/processing-policy";
export class UnavailableProcessingStages implements DocumentProcessingStages {
  readonly available = false;
  async prepare(): Promise<never> {
    throw new DocumentProcessingFailure("DOCUMENT_PROCESSING_UNAVAILABLE");
  }
}
