import { setTimeout as delay } from "node:timers/promises";
import type { EmbeddingResult } from "../../application/ports/embedding-provider.port";
import {
  DocumentProcessingFailure,
  processingFailure,
  processingFailures,
} from "../../domain/processing-policy";

export async function embeddingJson(
  url: URL,
  signal: AbortSignal,
  maximumBytes: number,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    redirect: "error",
    signal,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new DocumentProcessingFailure(
      response.status === 429
        ? "DOCUMENT_EMBEDDING_QUOTA"
        : response.status >= 500
          ? "DOCUMENT_EMBEDDING_UNAVAILABLE"
          : response.status === 401 || response.status === 403
            ? "DOCUMENT_EMBEDDING_UNAUTHORIZED"
            : response.status === 404
              ? "DOCUMENT_EMBEDDING_MODEL_MISMATCH"
              : response.status === 400 || response.status === 413
                ? "DOCUMENT_EMBEDDING_INPUT_LIMIT"
                : "DOCUMENT_EMBEDDING_RESULT_INVALID",
    );
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new DocumentProcessingFailure("DOCUMENT_EMBEDDING_RESULT_INVALID");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maximumBytes)
        throw new DocumentProcessingFailure(
          "DOCUMENT_EMBEDDING_RESULT_INVALID",
        );
      parts.push(result.value);
    }
    const result: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new Error();
    return result as Record<string, unknown>;
  } catch (error) {
    if (error instanceof DocumentProcessingFailure || signal.aborted)
      throw error;
    throw new DocumentProcessingFailure("DOCUMENT_EMBEDDING_RESULT_INVALID");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function embeddingWithRetry(
  limits: { timeoutMs: number; maxAttempts: number },
  signal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<EmbeddingResult>,
): Promise<EmbeddingResult> {
  if (signal.aborted)
    throw new DocumentProcessingFailure("DOCUMENT_EMBEDDING_TIMEOUT");
  for (let attempt = 1; ; attempt++) {
    const timeout = AbortSignal.timeout(limits.timeoutMs);
    const bounded = AbortSignal.any([signal, timeout]);
    try {
      return await operation(bounded);
    } catch (error) {
      const code =
        signal.aborted || timeout.aborted
          ? "DOCUMENT_EMBEDDING_TIMEOUT"
          : error instanceof DocumentProcessingFailure
            ? processingFailure(error)
            : "DOCUMENT_EMBEDDING_UNAVAILABLE";
      if (
        signal.aborted ||
        attempt >= limits.maxAttempts ||
        !processingFailures[code]
      )
        throw new DocumentProcessingFailure(code);
      try {
        await delay(
          100 * attempt + Math.floor(Math.random() * 100),
          undefined,
          { signal },
        );
      } catch {
        throw new DocumentProcessingFailure("DOCUMENT_EMBEDDING_TIMEOUT");
      }
    }
  }
}
