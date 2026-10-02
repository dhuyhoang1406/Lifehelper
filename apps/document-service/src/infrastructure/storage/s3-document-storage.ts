import { createHash } from "node:crypto";
import {
  S3Client,
  GetBucketVersioningCommand,
  GetPublicAccessBlockCommand,
  GetBucketAclCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  DocumentStorage,
  StoredObject,
} from "../../application/ports/document-storage.port";
import { DocumentApplicationError } from "../../application/errors/document.errors";
export interface S3DocumentConfig {
  endpoint: string;
  publicEndpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  timeoutMs: number;
  maxAttempts: number;
  maxConcurrentReads?: number;
}
function missing(error: unknown) {
  return (
    error instanceof Error &&
    ["NoSuchKey", "NotFound", "NoSuchVersion"].includes(error.name)
  );
}
export class S3DocumentStorage implements DocumentStorage {
  private readonly internal: S3Client;
  private readonly signing: S3Client;
  private activeReads = 0;
  constructor(private readonly config: S3DocumentConfig) {
    const shared = {
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
      maxAttempts: config.maxAttempts,
    };
    this.internal = new S3Client({ ...shared, endpoint: config.endpoint });
    this.signing = new S3Client({ ...shared, endpoint: config.publicEndpoint });
  }
  onModuleDestroy() {
    this.internal.destroy();
    this.signing.destroy();
  }
  private async bounded<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      return await operation(controller.signal);
    } catch (error) {
      if (error instanceof DocumentApplicationError) throw error;
      if (controller.signal.aborted)
        throw new DocumentApplicationError(
          "DOCUMENT_STORAGE_TIMEOUT",
          "Document storage timed out",
          504,
        );
      if (missing(error))
        throw new DocumentApplicationError(
          "DOCUMENT_OBJECT_MISSING",
          "Uploaded object was not found",
          404,
        );
      throw new DocumentApplicationError(
        "DOCUMENT_STORAGE_UNAVAILABLE",
        "Document storage is unavailable",
        503,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  async authorizeUpload(
    object: StoredObject,
    mimeType: string,
    bytes: number,
    expiresAt: Date,
  ) {
    return this.bounded(async (signal) => {
      const options = { abortSignal: signal };
      const versioning = await this.internal.send(
        new GetBucketVersioningCommand({ Bucket: object.bucket }),
        options,
      );
      const access = await this.internal.send(
        new GetPublicAccessBlockCommand({ Bucket: object.bucket }),
        options,
      );
      const acl = await this.internal.send(
        new GetBucketAclCommand({ Bucket: object.bucket }),
        options,
      );
      const block = access.PublicAccessBlockConfiguration;
      if (
        versioning.Status !== "Enabled" ||
        !block?.BlockPublicAcls ||
        !block.IgnorePublicAcls ||
        !block.BlockPublicPolicy ||
        !block.RestrictPublicBuckets ||
        acl.Grants?.some((g) => g.Grantee?.URI?.includes("groups/global"))
      )
        throw new DocumentApplicationError(
          "DOCUMENT_BUCKET_UNSAFE",
          "Document bucket must be private and versioned",
          503,
        );
      // Private-bucket checks and reservation time must not extend authorization.
      const expiresSeconds = Math.floor(
        (expiresAt.getTime() - Date.now()) / 1000,
      );
      if (expiresSeconds < 1)
        throw new DocumentApplicationError(
          "DOCUMENT_UPLOAD_EXPIRED",
          "Upload authorization expired",
          410,
        );
      return createPresignedPost(this.signing, {
        Bucket: object.bucket,
        Key: object.key,
        Expires: expiresSeconds,
        Fields: { "Content-Type": mimeType, success_action_status: "204" },
        Conditions: [
          ["content-length-range", bytes, bytes],
          ["eq", "$Content-Type", mimeType],
          ["eq", "$success_action_status", "204"],
        ],
      });
    });
  }
  async readForVerification(object: StoredObject, maximumBytes: number) {
    if (this.activeReads >= (this.config.maxConcurrentReads ?? 2))
      throw new DocumentApplicationError(
        "DOCUMENT_STORAGE_BUSY",
        "Document verification capacity reached; retry later",
        429,
      );
    this.activeReads++;
    try {
      return await this.bounded(async (signal) => {
        const head = await this.internal.send(
          new HeadObjectCommand({ Bucket: object.bucket, Key: object.key }),
          { abortSignal: signal },
        );
        if (!head.VersionId || head.VersionId === "null")
          throw new DocumentApplicationError(
            "DOCUMENT_BUCKET_UNSAFE",
            "Immutable object version is required",
            503,
          );
        if (!head.ContentLength || head.ContentLength > maximumBytes)
          throw new DocumentApplicationError(
            "DOCUMENT_SIZE_INVALID",
            "Uploaded object exceeds file limits",
            422,
          );
        const response = await this.internal.send(
          new GetObjectCommand({
            Bucket: object.bucket,
            Key: object.key,
            VersionId: head.VersionId,
          }),
          { abortSignal: signal },
        );
        if (!response.Body)
          throw new DocumentApplicationError(
            "DOCUMENT_OBJECT_MISSING",
            "Uploaded object has no body",
            404,
          );
        const parts: Buffer[] = [];
        let length = 0;
        const checksum = createHash("sha256");
        for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
          if (signal.aborted) throw new Error("Aborted");
          const bytes = Buffer.from(chunk);
          length += bytes.length;
          if (length > maximumBytes) {
            (response.Body as { destroy?: () => void }).destroy?.();
            throw new DocumentApplicationError(
              "DOCUMENT_SIZE_INVALID",
              "Uploaded object exceeds file limits",
              422,
            );
          }
          parts.push(bytes);
          checksum.update(bytes);
        }
        if (
          length !== head.ContentLength ||
          response.VersionId !== head.VersionId
        )
          throw new DocumentApplicationError(
            "DOCUMENT_UPLOAD_MISMATCH",
            "Uploaded object identity changed",
            422,
          );
        return {
          versionId: head.VersionId,
          checksumSha256: checksum.digest("hex"),
          sizeBytes: length,
          mimeType: response.ContentType ?? "",
          bytes: Buffer.concat(parts),
        };
      });
    } finally {
      this.activeReads--;
    }
  }
  async authorizeDownload(
    object: StoredObject,
    versionId: string,
    filename: string,
    expiresSeconds: number,
  ) {
    const ascii =
      filename.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 150) || "document";
    const encoded = encodeURIComponent(filename).replace(
      /[!'()*]/g,
      (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase(),
    );
    return getSignedUrl(
      this.signing,
      new GetObjectCommand({
        Bucket: object.bucket,
        Key: object.key,
        VersionId: versionId,
        ResponseContentDisposition: `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      }),
      { expiresIn: expiresSeconds },
    );
  }
}
