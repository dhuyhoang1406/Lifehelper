BEGIN;
-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "expected_checksum_sha256" VARCHAR(64),
ADD COLUMN     "storage_version_id" VARCHAR(1024),
ADD COLUMN     "upload_expires_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "document_cleanup_tasks" (
    "document_id" UUID NOT NULL,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_cleanup_tasks_pkey" PRIMARY KEY ("document_id")
);

-- CreateIndex
CREATE INDEX "document_cleanup_tasks_completed_at_next_attempt_at_idx" ON "document_cleanup_tasks"("completed_at", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "document_cleanup_tasks" ADD CONSTRAINT "document_cleanup_tasks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE documents ADD CONSTRAINT document_upload_identity_check CHECK (
  (storage_version_id IS NULL OR (length(storage_version_id) > 0 AND storage_version_id <> 'null' AND checksum_sha256 IS NOT NULL))
  AND (expected_checksum_sha256 IS NULL OR expected_checksum_sha256 ~ '^[a-f0-9]{64}$')
);
ALTER TABLE document_cleanup_tasks ADD CONSTRAINT document_cleanup_attempt_check CHECK (attempt_count >= 0);
CREATE FUNCTION enforce_document_upload_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.storage_version_id IS NOT NULL AND
    (NEW.storage_version_id IS DISTINCT FROM OLD.storage_version_id OR NEW.checksum_sha256 IS DISTINCT FROM OLD.checksum_sha256) THEN
    RAISE EXCEPTION 'Committed document object identity is immutable';
  END IF;
  IF NEW.size_bytes <> OLD.size_bytes OR NEW.mime_type <> OLD.mime_type OR
    NEW.expected_checksum_sha256 IS DISTINCT FROM OLD.expected_checksum_sha256 OR
    NEW.upload_expires_at IS DISTINCT FROM OLD.upload_expires_at THEN
    RAISE EXCEPTION 'Document upload authorization is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_upload_identity_guard BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION enforce_document_upload_identity();
COMMIT;
