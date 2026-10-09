import type {
  EmbeddingRequest,
  EmbeddingResult,
  EmbeddingSpace,
} from "../ports/embedding-provider.port";
import { DocumentProcessingFailure } from "../../domain/processing-policy";
export function sameEmbeddingSpace(
  a: EmbeddingSpace,
  b: EmbeddingSpace,
): boolean {
  return (
    a.model === b.model &&
    a.version === b.version &&
    a.dimensions === b.dimensions
  );
}
export function validVector(
  vector: readonly number[],
  dimensions: number,
): boolean {
  return (
    Array.isArray(vector) &&
    vector.length === dimensions &&
    vector.every(
      (v) => Number.isFinite(v) && Number.isFinite(Math.fround(v)),
    ) &&
    vector.some((v) => Math.fround(v) !== 0)
  );
}
export function validateEmbeddingResult(
  request: EmbeddingRequest,
  result: EmbeddingResult,
): void {
  if (
    !result ||
    !result.space ||
    !sameEmbeddingSpace(request.space, result.space)
  )
    throw new DocumentProcessingFailure("DOCUMENT_EMBEDDING_MODEL_MISMATCH");
  if (
    !Array.isArray(result.items) ||
    result.items.length !== request.items.length ||
    result.items.some(
      (item, i) =>
        !item ||
        item.id !== request.items[i].id ||
        !validVector(item.vector, request.space.dimensions),
    )
  )
    throw new DocumentProcessingFailure("DOCUMENT_EMBEDDING_RESULT_INVALID");
}
