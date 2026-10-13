BEGIN;
ALTER TABLE document_processing_jobs ADD COLUMN reprocess_key uuid;
CREATE UNIQUE INDEX document_processing_jobs_document_id_reprocess_key_key ON document_processing_jobs(document_id,reprocess_key);
ALTER TABLE document_cleanup_tasks DROP CONSTRAINT document_cleanup_tasks_pkey;
ALTER TABLE document_cleanup_tasks ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(), ALTER COLUMN document_id DROP NOT NULL,
 ADD COLUMN bucket text, ADD COLUMN key text, ADD COLUMN lease_owner varchar(128), ADD COLUMN lease_token integer NOT NULL DEFAULT 0,
 ADD COLUMN lease_expires_at timestamptz(6), ADD COLUMN error_code varchar(100), ADD PRIMARY KEY(id);
CREATE UNIQUE INDEX document_cleanup_tasks_document_id_key ON document_cleanup_tasks(document_id);
CREATE UNIQUE INDEX document_cleanup_tasks_bucket_key_key ON document_cleanup_tasks(bucket,key);
ALTER TABLE document_cleanup_tasks ADD CONSTRAINT cleanup_target_check CHECK(document_id IS NOT NULL OR (bucket IS NOT NULL AND key IS NOT NULL));
ALTER TABLE document_cleanup_tasks ADD CONSTRAINT cleanup_lease_check CHECK((lease_owner IS NULL)=(lease_expires_at IS NULL) AND lease_token>=0);
CREATE TABLE document_maintenance_cursors(name text PRIMARY KEY,cursor text,updated_at timestamptz(6) NOT NULL);
CREATE TABLE document_processing_audits(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid NOT NULL,job_id uuid NOT NULL,generation integer NOT NULL,
 lease_token integer NOT NULL,phase varchar(16) NOT NULL,status varchar(16) NOT NULL,started_at timestamptz(6) NOT NULL,finished_at timestamptz(6),duration_ms integer,
 metrics jsonb,error_code varchar(100),UNIQUE(job_id,lease_token),CHECK(generation>0 AND lease_token>0),CHECK(duration_ms IS NULL OR duration_ms>=0),
 CHECK(status IN ('RUNNING','SUCCEEDED','FAILED','RETRY','CANCELLED','EXPIRED')),CHECK(phase IN ('EXTRACTION','EMBEDDING')),
 CHECK(metrics IS NULL OR jsonb_typeof(metrics)='object'));
CREATE INDEX document_processing_audits_started_at_idx ON document_processing_audits(started_at);
CREATE INDEX document_cleanup_tasks_next_attempt_at_id_idx ON document_cleanup_tasks(next_attempt_at,id);
CREATE INDEX document_processing_audits_document_id_started_at_idx ON document_processing_audits(document_id,started_at);
COMMIT;
