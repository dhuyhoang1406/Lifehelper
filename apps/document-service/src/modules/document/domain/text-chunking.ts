import { DocumentProcessingFailure } from "./processing-policy";
import type { SourceLocator } from "./entities/document-chunk.entity";

export const TOKEN_ESTIMATOR_VERSION = "utf8-byte-upper-bound-v1";
export interface SourceTextUnit {
  text: string;
  source: number;
}
export interface ChunkingLimits {
  targetTokens: number;
  overlapTokens: number;
  maxChunks: number;
}
export interface TextChunk {
  content: string;
  tokenCount: number;
  locator: SourceLocator;
}
// Conservative budget for byte-level tokenizers, not a model-specific token count.
export function estimateTokens(text: string): number {
  let count = 0;
  for (const char of text) {
    const value = char.codePointAt(0)!;
    count += value < 0x80 ? 1 : value < 0x800 ? 2 : value < 0x10000 ? 3 : 4;
  }
  return count;
}
interface Piece {
  text: string;
  source: number;
  tokens: number;
  boundary: boolean;
}
export function chunkText(
  units: readonly SourceTextUnit[],
  kind: SourceLocator["kind"],
  limits: ChunkingLimits,
  checkpoint: () => void = () => undefined,
): TextChunk[] {
  if (
    !Number.isSafeInteger(limits.targetTokens) ||
    limits.targetTokens < 4 ||
    !Number.isSafeInteger(limits.overlapTokens) ||
    limits.overlapTokens < 0 ||
    limits.overlapTokens >= limits.targetTokens ||
    !Number.isSafeInteger(limits.maxChunks) ||
    limits.maxChunks < 1
  )
    throw new DocumentProcessingFailure("DOCUMENT_PROCESSING_RESULT_INVALID");
  const pieces: Piece[] = [];
  for (const unit of units) {
    checkpoint();
    if (
      !Number.isSafeInteger(unit.source) ||
      unit.source < 1 ||
      unit.text.includes("\0")
    )
      throw new DocumentProcessingFailure("DOCUMENT_PROCESSING_RESULT_INVALID");
    for (const match of unit.text.matchAll(/\S+|\s+/gu)) {
      checkpoint();
      const value = match[0];
      let fragment = "",
        tokens = 0;
      let visited = 0;
      for (const char of value) {
        if (visited++ % 256 === 0) checkpoint();
        const weight = estimateTokens(char);
        if (tokens + weight > limits.targetTokens) {
          pieces.push({
            text: fragment,
            source: unit.source,
            tokens,
            boundary: false,
          });
          fragment = "";
          tokens = 0;
        }
        fragment += char;
        tokens += weight;
      }
      if (fragment)
        pieces.push({
          text: fragment,
          source: unit.source,
          tokens,
          boundary: false,
        });
    }
    pieces.push({
      text: "\n",
      source: unit.source,
      tokens: 1,
      boundary: !unit.text.trim(),
    });
  }
  const chunks: TextChunk[] = [];
  let start = 0,
    previousEnd = 0;
  while (start < pieces.length) {
    checkpoint();
    let end = start,
      budget = 0,
      paragraphEnd = -1;
    while (
      end < pieces.length &&
      budget + pieces[end].tokens <= limits.targetTokens
    ) {
      budget += pieces[end].tokens;
      if (pieces[end].boundary && end + 1 > previousEnd) paragraphEnd = end + 1;
      end++;
    }
    if (end < pieces.length && paragraphEnd > start) end = paragraphEnd;
    const selected = pieces.slice(start, end),
      content = selected
        .map((p) => p.text)
        .join("")
        .trim();
    const referenced = selected.filter((p) => p.text.trim());
    if (content) {
      if (chunks.length >= limits.maxChunks)
        throw new DocumentProcessingFailure("DOCUMENT_CHUNK_LIMIT");
      chunks.push({
        content,
        tokenCount: estimateTokens(content),
        locator: {
          kind,
          start: referenced[0].source,
          end: referenced[referenced.length - 1].source,
        },
      });
    }
    if (end === pieces.length) break;
    let next = end,
      overlap = 0;
    while (
      next > start &&
      overlap + pieces[next - 1].tokens <= limits.overlapTokens
    )
      overlap += pieces[--next].tokens;
    previousEnd = end;
    start = next > start ? next : end;
  }
  if (!chunks.length)
    throw new DocumentProcessingFailure("DOCUMENT_TEXT_EMPTY");
  return chunks;
}
