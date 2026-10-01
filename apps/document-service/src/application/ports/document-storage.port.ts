export interface StoredObject {
  bucket: string;
  key: string;
}
export interface UploadAuthorization {
  url: string;
  fields: Record<string, string>;
}
export interface VerifiedObject {
  versionId: string;
  checksumSha256: string;
  sizeBytes: number;
  mimeType: string;
  bytes: Uint8Array;
}
export interface DocumentStorage {
  authorizeUpload(
    object: StoredObject,
    mimeType: string,
    bytes: number,
    expiresAt: Date,
  ): Promise<UploadAuthorization>;
  readForVerification(
    object: StoredObject,
    maximumBytes: number,
  ): Promise<VerifiedObject>;
  authorizeDownload(
    object: StoredObject,
    versionId: string,
    filename: string,
    expiresSeconds: number,
  ): Promise<string>;
}
export const DOCUMENT_STORAGE = Symbol("DOCUMENT_STORAGE");
