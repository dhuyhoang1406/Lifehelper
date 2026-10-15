export interface DocumentCitation {
  reference: number;
  documentId: string;
  chunkId: string;
  generation: number;
  filename: string;
  pageStart?: number;
  pageEnd?: number;
  lineStart?: number;
  lineEnd?: number;
}
