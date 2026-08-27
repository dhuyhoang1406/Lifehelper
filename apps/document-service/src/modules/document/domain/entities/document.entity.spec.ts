import { Document } from "./document.entity";
import { DocumentStatus } from "../enums/document-status.enum";
describe("Document", () => {
  const input = {
    id: "document-id",
    userId: "user-id",
    originalFilename: "file.pdf",
    storageFilename: "stored.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1n,
    s3Bucket: "bucket",
    s3Key: "key",
  };
  it("starts pending upload", () =>
    expect(Document.create(input).state.status).toBe(
      DocumentStatus.PENDING_UPLOAD,
    ));
  it("rejects negative size", () =>
    expect(() => Document.create({ ...input, sizeBytes: -1n })).toThrow(
      "negative",
    ));
  it("enforces processing transitions", () =>
    expect(() => Document.create(input).startProcessing()).toThrow("uploaded"));
});
