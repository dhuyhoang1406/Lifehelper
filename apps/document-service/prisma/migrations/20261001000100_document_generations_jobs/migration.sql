BEGIN;
-- CreateEnum
CREATE TYPE "ProcessingGenerationStatus" AS ENUM ('PROCESSING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "ProcessingJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- DropIndex
DROP INDEX "document_chunks_document_id_chunk_index_key";

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "active_generation" INTEGER,
ADD COLUMN     "processing_generation" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "document_chunks" ADD COLUMN     "generation" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "locator_end" INTEGER,
ADD COLUMN     "locator_kind" VARCHAR(10),
ADD COLUMN     "locator_start" INTEGER;

-- AlterTable
ALTER TABLE "document_embeddings" ADD COLUMN     "dimensions" INTEGER,
ADD COLUMN     "model_version" VARCHAR(100) NOT NULL DEFAULT 'legacy',
ALTER COLUMN "embedding" DROP NOT NULL;

-- CreateTable
CREATE TABLE "document_generations" (
    "document_id" UUID NOT NULL,
    "generation" INTEGER NOT NULL,
    "status" "ProcessingGenerationStatus" NOT NULL DEFAULT 'PROCESSING',
    "chunk_count" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "document_generations_pkey" PRIMARY KEY ("document_id","generation")
);

-- CreateTable
CREATE TABLE "document_processing_jobs" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "generation" INTEGER NOT NULL,
    "status" "ProcessingJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL,
    "lease_owner" VARCHAR(128),
    "lease_expires_at" TIMESTAMPTZ(6),
    "error_code" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_processing_jobs_pkey" PRIMARY KEY ("id")
);

-- Preserve Phase 0 vectors and create generation 1 for existing chunks.
UPDATE document_embeddings SET dimensions = vector_dims(embedding);
ALTER TABLE document_embeddings ALTER COLUMN dimensions SET NOT NULL;
INSERT INTO document_generations(document_id, generation, status, chunk_count, created_at, completed_at)
SELECT d.id, 1, CASE WHEN d.status = 'READY' THEN 'COMPLETE'::"ProcessingGenerationStatus"
  ELSE 'PROCESSING'::"ProcessingGenerationStatus" END,
  CASE WHEN d.status = 'READY' THEN (SELECT count(*) FROM document_chunks c WHERE c.document_id = d.id) END,
  d.created_at, CASE WHEN d.status = 'READY' THEN d.updated_at END
FROM documents d WHERE d.status IN ('PROCESSING', 'READY') OR EXISTS
  (SELECT 1 FROM document_chunks c WHERE c.document_id = d.id);
UPDATE documents d SET processing_generation = 1,
  active_generation = CASE WHEN status = 'READY' THEN 1 END
WHERE EXISTS (SELECT 1 FROM document_generations g WHERE g.document_id = d.id);

-- CreateIndex
CREATE INDEX "document_processing_jobs_status_next_attempt_at_id_idx" ON "document_processing_jobs"("status", "next_attempt_at", "id");

-- CreateIndex
CREATE INDEX "document_processing_jobs_status_lease_expires_at_idx" ON "document_processing_jobs"("status", "lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "document_processing_jobs_document_id_generation_key" ON "document_processing_jobs"("document_id", "generation");

-- CreateIndex
CREATE INDEX "documents_user_id_deleted_at_created_at_id_idx" ON "documents"("user_id", "deleted_at", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_document_id_generation_chunk_index_key" ON "document_chunks"("document_id", "generation", "chunk_index");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_id_active_generation_fkey" FOREIGN KEY ("id", "active_generation") REFERENCES "document_generations"("document_id", "generation") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_generation_fkey" FOREIGN KEY ("document_id", "generation") REFERENCES "document_generations"("document_id", "generation") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_generations" ADD CONSTRAINT "document_generations_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_processing_jobs" ADD CONSTRAINT "document_processing_jobs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_processing_jobs" ADD CONSTRAINT "document_processing_jobs_document_id_generation_fkey" FOREIGN KEY ("document_id", "generation") REFERENCES "document_generations"("document_id", "generation") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE documents ADD CONSTRAINT documents_lifecycle_check CHECK (
  processing_generation >= 0 AND revision >= 0
  AND (active_generation IS NULL OR (active_generation > 0 AND active_generation <= processing_generation))
  AND (status <> 'READY' OR (active_generation IS NOT NULL AND active_generation = processing_generation))
  AND ((status = 'DELETED') = (deleted_at IS NOT NULL))
  AND (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[a-f0-9]{64}$')
  AND (processing_error IS NULL OR processing_error ~ '^[A-Z][A-Z0-9_]{0,99}$')
);
ALTER TABLE document_generations ADD CONSTRAINT document_generation_check CHECK (
  generation > 0 AND (chunk_count IS NULL OR chunk_count > 0)
  AND ((status = 'COMPLETE') = (completed_at IS NOT NULL))
  AND (status <> 'COMPLETE' OR chunk_count IS NOT NULL)
);
ALTER TABLE document_chunks ADD CONSTRAINT document_chunk_locator_check CHECK (
  generation > 0 AND length(btrim(content)) > 0 AND
  ((locator_kind IS NULL AND locator_start IS NULL AND locator_end IS NULL) OR
   (locator_kind IS NOT NULL AND locator_kind IN ('PAGE', 'LINE') AND locator_start IS NOT NULL
    AND locator_end IS NOT NULL AND locator_start > 0 AND locator_end >= locator_start))
);
ALTER TABLE document_embeddings ADD CONSTRAINT document_embedding_metadata_check CHECK (
  dimensions > 0 AND length(btrim(embedding_model)) > 0 AND length(btrim(model_version)) > 0
  AND (embedding IS NULL OR vector_dims(embedding) = dimensions)
);
ALTER TABLE document_processing_jobs ADD CONSTRAINT document_job_check CHECK (
  generation > 0 AND attempt_count >= 0
  AND ((status = 'RUNNING' AND lease_owner IS NOT NULL AND length(btrim(lease_owner)) > 0
       AND lease_expires_at IS NOT NULL) OR
       (status <> 'RUNNING' AND lease_owner IS NULL AND lease_expires_at IS NULL))
  AND (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{0,99}$')
);
-- Legacy invalid READY records must be reconciled explicitly before migration.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM documents d WHERE d.status = 'READY' AND EXISTS (
    SELECT 1 FROM document_chunks c LEFT JOIN document_embeddings e ON e.chunk_id = c.id
    WHERE c.document_id = d.id AND (e.id IS NULL OR e.embedding IS NULL OR c.token_count IS NULL OR c.locator_kind IS NULL))) THEN
    RAISE EXCEPTION 'Reconcile incomplete legacy READY documents before migration';
  END IF;
END $$;
CREATE FUNCTION enforce_document_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_count integer; actual_count integer; valid_count integer; maximum_index integer;
BEGIN
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'PENDING_UPLOAD' AND NEW.status IN ('UPLOADED', 'DELETED')) OR
    (OLD.status = 'UPLOADED' AND NEW.status IN ('PROCESSING', 'FAILED', 'DELETED')) OR
    (OLD.status = 'PROCESSING' AND NEW.status IN ('READY', 'FAILED', 'DELETED')) OR
    (OLD.status IN ('READY', 'FAILED') AND NEW.status IN ('PROCESSING', 'DELETED'))
  ) THEN RAISE EXCEPTION 'Illegal document lifecycle transition'; END IF;
  IF NEW.user_id <> OLD.user_id OR NEW.s3_key <> OLD.s3_key OR NEW.s3_bucket <> OLD.s3_bucket THEN
    RAISE EXCEPTION 'Document owner and object identity are immutable';
  END IF;
  IF NEW.status = 'PROCESSING' AND OLD.status <> 'PROCESSING' THEN
    IF NEW.processing_generation <> OLD.processing_generation + 1 THEN
      RAISE EXCEPTION 'Processing must increment generation';
    END IF;
  ELSIF NEW.processing_generation <> OLD.processing_generation THEN
    RAISE EXCEPTION 'Generation can only change when starting processing';
  END IF;
  IF NEW.status = 'READY' THEN
    SELECT chunk_count INTO expected_count FROM document_generations
      WHERE document_id = NEW.id AND generation = NEW.active_generation AND status = 'COMPLETE';
    SELECT count(*)::int, count(*) FILTER (WHERE c.token_count IS NOT NULL AND c.locator_kind IS NOT NULL
      AND e.embedding IS NOT NULL)::int, max(c.chunk_index) INTO actual_count, valid_count, maximum_index
      FROM document_chunks c LEFT JOIN document_embeddings e ON e.chunk_id = c.id
      WHERE c.document_id = NEW.id AND c.generation = NEW.active_generation;
    IF expected_count IS NULL OR actual_count = 0 OR expected_count <> actual_count
      OR valid_count <> actual_count OR maximum_index <> actual_count - 1 THEN
      RAISE EXCEPTION 'READY requires a complete searchable generation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_lifecycle_guard BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION enforce_document_lifecycle();
COMMIT;
