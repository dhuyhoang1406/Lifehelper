export const processingFailures = {
  DOCUMENT_PROCESSING_UNAVAILABLE: false,
  DOCUMENT_UNSUPPORTED_INPUT: false,
  DOCUMENT_TEXT_EMPTY: false,
  DOCUMENT_TEXT_INVALID: false,
  DOCUMENT_FILE_LIMIT: false,
  DOCUMENT_PAGE_LIMIT: false,
  DOCUMENT_TEXT_LIMIT: false,
  DOCUMENT_CHUNK_LIMIT: false,
  DOCUMENT_PDF_ENCRYPTED: false,
  DOCUMENT_PDF_INVALID: false,
  DOCUMENT_PDF_NO_TEXT: false,
  DOCUMENT_PARSER_RESOURCE_LIMIT: false,
  DOCUMENT_PARSER_TIMEOUT: true,
  DOCUMENT_SOURCE_MISMATCH: false,
  DOCUMENT_OBJECT_MISSING: false,
  DOCUMENT_PROCESSING_RESULT_INVALID: false,
  DOCUMENT_PROCESSING_UNEXPECTED: false,
  DOCUMENT_STORAGE_TIMEOUT: true,
  DOCUMENT_STORAGE_UNAVAILABLE: true,
  DOCUMENT_STORAGE_BUSY: true,
  DOCUMENT_PROCESSING_TIMEOUT: true,
  DOCUMENT_WORKER_LEASE_EXPIRED: true,
} as const;
export type ProcessingFailureCode = keyof typeof processingFailures;
export class DocumentProcessingFailure extends Error {
  constructor(readonly code: ProcessingFailureCode) {
    super(code);
  }
}
export function processingFailure(error: unknown): ProcessingFailureCode {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : null;
  return typeof code === "string" && Object.hasOwn(processingFailures, code)
    ? (code as ProcessingFailureCode)
    : "DOCUMENT_PROCESSING_UNEXPECTED";
}
export function retryEligible(code: string | null): boolean {
  return (
    code === "DOCUMENT_PROCESSING_UNAVAILABLE" ||
    (code !== null &&
      Object.hasOwn(processingFailures, code) &&
      processingFailures[code as ProcessingFailureCode])
  );
}
export interface ProcessingRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}
export function retryDelay(
  attempt: number,
  policy: ProcessingRetryPolicy,
  random = Math.random,
): number {
  const ceiling = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** Math.min(Math.max(attempt - 1, 0), 20),
  );
  return Math.floor(
    ceiling / 2 + (Math.min(1, Math.max(0, random())) * ceiling) / 2,
  );
}
