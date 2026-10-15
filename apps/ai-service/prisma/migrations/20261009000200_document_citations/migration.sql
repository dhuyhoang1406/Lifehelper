ALTER TABLE messages ADD COLUMN citations jsonb, ADD COLUMN document_coverage jsonb;
ALTER TABLE messages ADD CONSTRAINT message_citations_array_check CHECK (citations IS NULL OR (role='ASSISTANT' AND jsonb_typeof(citations)='array'));
ALTER TABLE messages ADD CONSTRAINT message_document_coverage_object_check CHECK (document_coverage IS NULL OR (role='ASSISTANT' AND jsonb_typeof(document_coverage)='object'));
