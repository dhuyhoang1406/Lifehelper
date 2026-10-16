BEGIN;
-- Fail atomically on ambiguous legacy event duplicates; never delete notification history.
DO $$ BEGIN
  IF EXISTS (SELECT source_event_id FROM notifications WHERE source_event_id IS NOT NULL GROUP BY source_event_id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Duplicate notification source_event_id; reconcile explicitly before migration';
  END IF;
END $$;
ALTER TABLE notifications
  ADD COLUMN source_reminder_id uuid,
  ADD COLUMN dispatch_version integer,
  ADD COLUMN read_at timestamptz(6),
  ADD COLUMN eligible_at timestamptz(6),
  ADD COLUMN expires_at timestamptz(6),
  ADD COLUMN suppressed_at timestamptz(6),
  ADD COLUMN suppression_reason varchar(100),
  ADD COLUMN failure_reason varchar(100);
UPDATE notifications SET eligible_at=created_at;
ALTER TABLE notifications ALTER COLUMN eligible_at SET NOT NULL, ALTER COLUMN eligible_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE notifications ADD CONSTRAINT notification_dispatch_identity_check CHECK (
  (source_reminder_id IS NULL AND dispatch_version IS NULL) OR
  (source_reminder_id IS NOT NULL AND dispatch_version IS NOT NULL AND dispatch_version>0
   AND type='REMINDER' AND source_event_id IS NOT NULL AND expires_at IS NOT NULL));
ALTER TABLE notifications ADD CONSTRAINT notification_expiry_check CHECK (expires_at IS NULL OR expires_at>eligible_at);
ALTER TABLE notifications ADD CONSTRAINT notification_suppression_check CHECK ((suppressed_at IS NULL)=(suppression_reason IS NULL));
DROP INDEX notifications_source_event_id_idx;
CREATE UNIQUE INDEX notifications_source_event_id_key ON notifications(source_event_id);
CREATE UNIQUE INDEX notifications_source_reminder_id_dispatch_version_key ON notifications(source_reminder_id,dispatch_version);
CREATE INDEX notifications_user_id_created_at_id_idx ON notifications(user_id,created_at,id);

ALTER TABLE notification_deliveries ADD COLUMN failed_at timestamptz(6), ADD COLUMN skipped_at timestamptz(6), ADD COLUMN next_attempt_at timestamptz(6);
UPDATE notification_deliveries SET next_attempt_at=created_at;
ALTER TABLE notification_deliveries ALTER COLUMN next_attempt_at SET NOT NULL, ALTER COLUMN next_attempt_at SET DEFAULT CURRENT_TIMESTAMP;
-- Existing provider errors remain historical data; new writes use the domain safe-code allowlist.
CREATE TABLE notification_inbox_records (
  consumer varchar(120) NOT NULL,
  event_id uuid NOT NULL,
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  processed_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(consumer,event_id)
);
CREATE INDEX notification_inbox_records_notification_id_idx ON notification_inbox_records(notification_id);
CREATE TABLE notification_dispatch_work (
  notification_id uuid PRIMARY KEY REFERENCES notifications(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  next_attempt_at timestamptz(6) NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  lease_owner varchar(120),
  lease_token integer NOT NULL DEFAULT 0 CHECK(lease_token>=0),
  lease_expires_at timestamptz(6),
  targets_resolved_at timestamptz(6),
  completed_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error varchar(100),
  CONSTRAINT notification_work_lease_check CHECK ((lease_owner IS NULL)=(lease_expires_at IS NULL)),
  CONSTRAINT notification_completed_work_check CHECK (completed_at IS NULL OR lease_owner IS NULL)
);
CREATE INDEX notification_dispatch_work_due_idx ON notification_dispatch_work(completed_at,next_attempt_at,notification_id);
COMMIT;
