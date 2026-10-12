import type { ToolUserContext } from "./productivity-read.port";
export interface DocumentPassage {
  documentId: string;
  chunkId: string;
  generation: number;
  chunkIndex: number;
  filename: string;
  locator: { kind: "LINE" | "PAGE"; start: number; end: number };
}
export interface DocumentSearchMatch extends DocumentPassage {
  excerpt: string;
  similarity: number;
}
export interface DocumentChunk extends DocumentPassage {
  content: string;
}
export interface DocumentReadClient {
  search(
    context: ToolUserContext,
    input: { query: string; topK: number; documentIds?: readonly string[] },
  ): Promise<readonly DocumentSearchMatch[]>;
  chunks(
    context: ToolUserContext,
    documentId: string,
    input: { limit: number; generation?: number; after?: number },
  ): Promise<{
    items: readonly DocumentChunk[];
    next: { generation: number; after: number } | null;
  }>;
  chunk(
    context: ToolUserContext,
    documentId: string,
    chunkId: string,
    generation: number,
  ): Promise<DocumentChunk>;
}
export interface DocumentScope {
  mode: "search" | "summarize";
  documentIds?: string[];
}
export const DOCUMENT_READ_CLIENT = Symbol("DOCUMENT_READ_CLIENT");
