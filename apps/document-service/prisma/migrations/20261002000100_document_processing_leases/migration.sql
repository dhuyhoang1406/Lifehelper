BEGIN;
ALTER TABLE document_processing_jobs ADD COLUMN lease_token INTEGER NOT NULL DEFAULT 0;
-- Invalidate unfenced legacy leases during a coordinated worker deployment.
UPDATE document_processing_jobs SET status='PENDING', lease_owner=NULL, lease_expires_at=NULL,
  next_attempt_at=clock_timestamp(), error_code='DOCUMENT_WORKER_LEASE_EXPIRED'
  WHERE status='RUNNING';
ALTER TABLE document_processing_jobs ADD CONSTRAINT document_job_fencing_check CHECK (
  lease_token >= 0 AND (status <> 'RUNNING' OR lease_token > 0)
);
-- Reconcile Branch 2 verified UPLOADED rows without inventing object identity.
INSERT INTO document_generations(document_id,generation,status,created_at)
SELECT d.id,d.processing_generation+1,'PROCESSING',clock_timestamp() FROM documents d
WHERE d.status='UPLOADED' AND d.deleted_at IS NULL AND d.storage_version_id IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO document_processing_jobs(id,document_id,generation,status,next_attempt_at,created_at,updated_at)
SELECT gen_random_uuid(),d.id,d.processing_generation+1,'PENDING',clock_timestamp(),clock_timestamp(),clock_timestamp()
FROM documents d WHERE d.status='UPLOADED' AND d.deleted_at IS NULL AND d.storage_version_id IS NOT NULL
ON CONFLICT(document_id,generation) DO NOTHING;
WITH pending_events AS (
  SELECT gen_random_uuid() AS event_id, date_trunc('milliseconds',clock_timestamp()) AS at,
    j.document_id,j.id AS job_id,j.generation
  FROM document_processing_jobs j JOIN documents d ON d.id=j.document_id
  WHERE d.status='UPLOADED' AND d.storage_version_id IS NOT NULL AND j.generation=d.processing_generation+1
    AND NOT EXISTS(SELECT 1 FROM outbox_events e WHERE e.aggregate_id=d.id AND e.event_type='document.uploaded')
)
INSERT INTO outbox_events(id,event_type,aggregate_type,aggregate_id,payload,occurred_at)
SELECT event_id,'document.uploaded','document',document_id,
  jsonb_build_object('id',event_id,'type','document.uploaded','version',1,'producer','document-service',
    'correlationId',job_id,'occurredAt',to_char(at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload',jsonb_build_object('documentId',document_id,'jobId',job_id,'generation',generation,'attempt',0)),at
FROM pending_events;
COMMIT;
