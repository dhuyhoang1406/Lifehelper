ALTER TYPE "ProcessingGenerationStatus" ADD VALUE 'EXTRACTED';
ALTER TABLE document_generations
  ADD COLUMN processing_version VARCHAR(100),
  ADD COLUMN source_checksum_sha256 VARCHAR(64),
  ADD COLUMN source_version_id VARCHAR(1024),
  ADD COLUMN extracted_at TIMESTAMPTZ(6);
ALTER TABLE document_generations ADD CONSTRAINT document_extraction_identity_check CHECK (
  (extracted_at IS NULL AND processing_version IS NULL AND source_checksum_sha256 IS NULL AND source_version_id IS NULL)
  OR (extracted_at IS NOT NULL AND processing_version IS NOT NULL AND length(processing_version)>0
      AND source_checksum_sha256 IS NOT NULL AND source_checksum_sha256 ~ '^[0-9a-f]{64}$'
      AND source_version_id IS NOT NULL AND length(source_version_id)>0 AND chunk_count IS NOT NULL));
ALTER TABLE document_generations ADD CONSTRAINT document_extracted_stage_check
  CHECK (status::text <> 'EXTRACTED' OR extracted_at IS NOT NULL);
