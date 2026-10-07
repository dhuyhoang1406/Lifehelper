import { randomUUID } from "node:crypto";
import { retryEligible } from "../../domain/processing-policy";
import { Document } from "../../domain/entities/document.entity";
import type { DocumentRepository } from "../repositories/document.repositories";
import type { DocumentUploadRepository } from "../ports/document-upload.repository";
import type { DocumentStorage } from "../ports/document-storage.port";
import {
  DocumentApplicationError,
  documentNotFound,
} from "../errors/document.errors";

export interface DocumentUploadLimits {
  allowedExtensions: readonly string[];
  maxFileBytes: number;
  maxDocuments: number;
  maxStorageBytes: number;
  uploadExpirySeconds: number;
  downloadExpirySeconds: number;
  bucket: string;
}
export interface UploadRequest {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256?: string;
}
const mimeTypes: Record<string, readonly string[]> = {
  txt: ["text/plain"],
  md: ["text/plain", "text/markdown"],
  pdf: ["application/pdf"],
};
function extension(filename: string) {
  return filename.split(".").at(-1)?.toLowerCase() ?? "";
}
function verifyContent(bytes: Uint8Array, ext: string) {
  if (ext === "pdf") {
    const header = Buffer.from(bytes.subarray(0, 8)).toString("latin1");
    if (!/^%PDF-1\.[0-7]|^%PDF-2\.0/.test(header))
      throw new DocumentApplicationError(
        "DOCUMENT_SIGNATURE_INVALID",
        "File signature does not match PDF",
        422,
      );
    return;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0") || /^[\s\uFEFF]*%PDF-/.test(text))
      throw new Error();
  } catch {
    throw new DocumentApplicationError(
      "DOCUMENT_SIGNATURE_INVALID",
      "File must contain UTF-8 plain text",
      422,
    );
  }
}
export class DocumentUploadUseCases {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly uploads: DocumentUploadRepository,
    private readonly storage: DocumentStorage,
    private readonly limits: DocumentUploadLimits,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async uploadUrl(userId: string, request: UploadRequest) {
    const ext = extension(request.filename);
    if (
      !this.limits.allowedExtensions.includes(ext) ||
      !mimeTypes[ext]?.includes(request.mimeType) ||
      !request.filename.trim() ||
      request.filename.length > 255 ||
      /[\uD800-\uDFFF]/u.test(request.filename) ||
      Array.from(request.filename).some(
        (char) =>
          char.charCodeAt(0) < 32 ||
          char.charCodeAt(0) === 127 ||
          "/\\".includes(char),
      ) ||
      !Number.isSafeInteger(request.sizeBytes) ||
      request.sizeBytes < 1 ||
      request.sizeBytes > this.limits.maxFileBytes ||
      (request.checksumSha256 !== undefined &&
        !/^[a-f0-9]{64}$/.test(request.checksumSha256))
    )
      throw new DocumentApplicationError(
        "DOCUMENT_UPLOAD_INVALID",
        "Unsupported filename, type, size or checksum",
        400,
      );
    const at = this.now();
    const id = randomUUID();
    const storageFilename = `${randomUUID()}.${ext}`;
    const expiresAt = new Date(
      at.getTime() + this.limits.uploadExpirySeconds * 1000,
    );
    const document = Document.create({
      id,
      userId,
      originalFilename: request.filename,
      storageFilename,
      mimeType: request.mimeType,
      sizeBytes: BigInt(request.sizeBytes),
      s3Bucket: this.limits.bucket,
      s3Key: `users/${userId}/documents/${id}/${storageFilename}`,
      createdAt: at,
      uploadExpiresAt: expiresAt,
      expectedChecksumSha256: request.checksumSha256,
    });
    await this.uploads.reserve(
      document,
      this.limits.maxDocuments,
      BigInt(this.limits.maxStorageBytes),
    );
    let upload;
    try {
      upload = await this.storage.authorizeUpload(
        { bucket: document.state.s3Bucket, key: document.state.s3Key },
        request.mimeType,
        request.sizeBytes,
        expiresAt,
      );
    } catch (error) {
      // No authorization reached the client: release its logical quota and retain
      // a durable cleanup record in case signing/upload state was ambiguous.
      await this.uploads.deleteAndScheduleCleanup(id, userId, this.now());
      throw error;
    }
    return {
      document: this.view(document),
      upload: { method: "POST", ...upload, expiresAt },
    };
  }
  async complete(userId: string, id: string) {
    const document = await this.owned(userId, id);
    const state = document.state;
    if (state.storageVersionId) return this.view(document);
    if (state.status !== "PENDING_UPLOAD")
      throw new DocumentApplicationError(
        "DOCUMENT_UPLOAD_STATE_INVALID",
        "Document is not pending upload",
        409,
      );
    if (!state.uploadExpiresAt || state.uploadExpiresAt <= this.now())
      throw new DocumentApplicationError(
        "DOCUMENT_UPLOAD_EXPIRED",
        "Upload authorization expired",
        410,
      );
    const object = await this.storage.readForVerification(
      { bucket: state.s3Bucket, key: state.s3Key },
      this.limits.maxFileBytes,
    );
    if (
      BigInt(object.sizeBytes) !== state.sizeBytes ||
      object.mimeType !== state.mimeType
    )
      throw new DocumentApplicationError(
        "DOCUMENT_UPLOAD_MISMATCH",
        "Uploaded size or type does not match authorization",
        422,
      );
    if (
      state.expectedChecksumSha256 &&
      object.checksumSha256 !== state.expectedChecksumSha256
    )
      throw new DocumentApplicationError(
        "DOCUMENT_CHECKSUM_MISMATCH",
        "Uploaded checksum does not match",
        422,
      );
    verifyContent(object.bytes, extension(state.storageFilename));
    const changed = await this.uploads.commitUpload(
      id,
      userId,
      state.revision,
      object.versionId,
      object.checksumSha256,
      this.now(),
    );
    const current = await this.owned(userId, id);
    if (!changed && !current.state.storageVersionId) {
      if (
        current.state.uploadExpiresAt &&
        current.state.uploadExpiresAt <= this.now()
      )
        throw new DocumentApplicationError(
          "DOCUMENT_UPLOAD_EXPIRED",
          "Upload authorization expired",
          410,
        );
      throw new DocumentApplicationError(
        "DOCUMENT_UPLOAD_CONFLICT",
        "Upload state changed; retry completion",
        409,
      );
    }
    return this.view(current);
  }
  async list(userId: string, limit: number) {
    return (await this.documents.findByUserId(userId, limit)).map((d) =>
      this.view(d),
    );
  }
  async get(userId: string, id: string) {
    return this.view(await this.owned(userId, id));
  }
  async download(userId: string, id: string) {
    const d = (await this.owned(userId, id)).state;
    if (!d.storageVersionId)
      throw new DocumentApplicationError(
        "DOCUMENT_NOT_UPLOADED",
        "Document upload is not complete",
        409,
      );
    const url = await this.storage.authorizeDownload(
      { bucket: d.s3Bucket, key: d.s3Key },
      d.storageVersionId,
      d.originalFilename,
      this.limits.downloadExpirySeconds,
    );
    return {
      url,
      expiresAt: new Date(
        this.now().getTime() + this.limits.downloadExpirySeconds * 1000,
      ),
    };
  }
  async delete(userId: string, id: string) {
    if (!(await this.uploads.deleteAndScheduleCleanup(id, userId, this.now())))
      throw documentNotFound();
  }
  private async owned(userId: string, id: string) {
    const d = await this.documents.findByIdAndUserId(id, userId);
    if (!d) throw documentNotFound();
    return d;
  }
  private view(d: Document) {
    const s = d.state;
    return {
      id: s.id,
      originalFilename: s.originalFilename,
      mimeType: s.mimeType,
      sizeBytes: Number(s.sizeBytes),
      status: s.status,
      processingError: s.processingError,
      retryEligible: s.status === "FAILED" && retryEligible(s.processingError),
      checksumSha256: s.storageVersionId ? s.checksumSha256 : null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      uploadExpiresAt: s.uploadExpiresAt,
    };
  }
}
