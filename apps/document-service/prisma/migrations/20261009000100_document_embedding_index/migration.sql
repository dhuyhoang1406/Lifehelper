BEGIN;
-- The baseline already uses pgvector. Keep this idempotent; never rewrite deployed migrations.
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE document_generations
  ADD COLUMN embedding_model varchar(100),
  ADD COLUMN embedding_version varchar(100),
  ADD COLUMN embedding_dimensions integer,
  ADD COLUMN embedding_settings jsonb;
-- Preserve compatible historical COMPLETE generations; fail rather than invent an embedding space.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM document_generations g JOIN document_chunks c
    ON c.document_id=g.document_id AND c.generation=g.generation
    LEFT JOIN document_embeddings e ON e.chunk_id=c.id WHERE g.status='COMPLETE'
    GROUP BY g.document_id,g.generation HAVING count(DISTINCT (e.embedding_model,e.model_version,e.dimensions))<>1 OR count(e.id)<>count(*)) THEN
    RAISE EXCEPTION 'Reconcile incompatible legacy COMPLETE embedding spaces before migration';
  END IF;
END $$;
UPDATE document_generations g SET embedding_model=e.embedding_model, embedding_version=e.model_version,
  embedding_dimensions=e.dimensions, embedding_settings='{"inputPolicy":"legacy"}'::jsonb
FROM document_chunks c JOIN document_embeddings e ON e.chunk_id=c.id
WHERE c.document_id=g.document_id AND c.generation=g.generation AND g.status='COMPLETE';
ALTER TABLE document_generations ADD CONSTRAINT document_generation_embedding_space_check CHECK (
  (embedding_model IS NULL AND embedding_version IS NULL AND embedding_dimensions IS NULL AND embedding_settings IS NULL) OR
  (embedding_model IS NOT NULL AND length(btrim(embedding_model))>0 AND embedding_version IS NOT NULL
    AND length(btrim(embedding_version))>0 AND embedding_dimensions IS NOT NULL AND embedding_dimensions BETWEEN 1 AND 16000
    AND embedding_settings IS NOT NULL AND jsonb_typeof(embedding_settings)='object')
);
ALTER TABLE document_embeddings ADD CONSTRAINT document_embedding_cosine_check CHECK (
  embedding IS NULL OR vector_norm(embedding)>0
);
-- Resume Branch 4 extraction-only successes; fenced workers index the existing chunks.
UPDATE document_processing_jobs j SET status='PENDING', attempt_count=0, next_attempt_at=clock_timestamp(),
  updated_at=clock_timestamp(), error_code=NULL
FROM documents d JOIN document_generations g ON g.document_id=d.id AND g.generation=d.processing_generation
WHERE j.document_id=d.id AND j.generation=g.generation AND j.status='SUCCEEDED'
  AND g.status='EXTRACTED' AND d.status='PROCESSING' AND d.deleted_at IS NULL;
CREATE OR REPLACE FUNCTION enforce_document_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
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
      WHERE document_id = NEW.id AND generation = NEW.active_generation AND status = 'COMPLETE' AND embedding_model IS NOT NULL AND embedding_version IS NOT NULL AND embedding_dimensions IS NOT NULL;
    SELECT count(*)::int, count(*) FILTER (WHERE c.token_count IS NOT NULL AND c.locator_kind IS NOT NULL
      AND e.embedding IS NOT NULL AND EXISTS (SELECT 1 FROM document_generations g
        WHERE g.document_id=c.document_id AND g.generation=c.generation
          AND e.embedding_model=g.embedding_model AND e.model_version=g.embedding_version
          AND e.dimensions=g.embedding_dimensions))::int, max(c.chunk_index) INTO actual_count, valid_count, maximum_index
      FROM document_chunks c LEFT JOIN document_embeddings e ON e.chunk_id = c.id
      WHERE c.document_id = NEW.id AND c.generation = NEW.active_generation;
    IF expected_count IS NULL OR actual_count = 0 OR expected_count <> actual_count
      OR valid_count <> actual_count OR maximum_index <> actual_count - 1 THEN
      RAISE EXCEPTION 'READY requires a complete searchable generation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
COMMIT;
