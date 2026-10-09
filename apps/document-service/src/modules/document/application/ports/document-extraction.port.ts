import type { SourceTextUnit } from "../../domain/text-chunking";
import type { SourceLocator } from "../../domain/entities/document-chunk.entity";
export interface ExtractionLimits {
  maxFileBytes: number;
  maxPages: number;
  maxTextChars: number;
  maxExpansionRatio: number;
  timeoutMs: number;
  memoryMb: number;
}
export interface ExtractedText {
  units: readonly SourceTextUnit[];
  locatorKind: SourceLocator["kind"];
}
export interface DocumentTextExtractor {
  extract(
    bytes: Uint8Array,
    mimeType: string,
    signal: AbortSignal,
  ): Promise<ExtractedText>;
}
export const DOCUMENT_TEXT_EXTRACTOR = Symbol("DOCUMENT_TEXT_EXTRACTOR");
