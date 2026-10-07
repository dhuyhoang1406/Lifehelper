import type { DocumentProcessingRepository } from "../ports/document-processing.port";
export class DocumentProcessingRetryUseCase {
  constructor(private readonly jobs: DocumentProcessingRepository) {}
  execute(documentId: string, userId: string) {
    return this.jobs.retry(documentId, userId);
  }
}
