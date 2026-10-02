export class DocumentApplicationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}
export const documentNotFound = () =>
  new DocumentApplicationError("DOCUMENT_NOT_FOUND", "Document not found", 404);
