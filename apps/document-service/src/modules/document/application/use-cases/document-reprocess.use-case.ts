import type { DocumentLifecycleRepository } from "../ports/document-lifecycle.port";
import { DocumentApplicationError } from "../errors/document.errors";
export class DocumentReprocessUseCase {
  constructor(private readonly lifecycle: DocumentLifecycleRepository) {}
  execute(id: string, userId: string, key: string | undefined) {
    if (
      !key ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        key,
      )
    )
      throw new DocumentApplicationError(
        "DOCUMENT_IDEMPOTENCY_KEY_INVALID",
        "A UUID x-idempotency-key header is required",
        400,
      );
    return this.lifecycle.reprocess(id, userId, key.toLowerCase());
  }
}
