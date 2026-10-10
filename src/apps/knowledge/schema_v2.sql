CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE knowledge_content_units
    ADD COLUMN IF NOT EXISTS labels text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS annotation text,
    ADD COLUMN IF NOT EXISTS media_type text,
    ADD COLUMN IF NOT EXISTS media_sha256 char(64);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_units_locator_idx
    ON knowledge_content_units (source_revision_id, kind, locator);
CREATE INDEX IF NOT EXISTS knowledge_units_body_search_idx
    ON knowledge_content_units USING gin (body gin_trgm_ops);
CREATE INDEX IF NOT EXISTS knowledge_units_annotation_search_idx
    ON knowledge_content_units USING gin (annotation gin_trgm_ops);
CREATE INDEX IF NOT EXISTS knowledge_sources_title_search_idx
    ON knowledge_sources USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS knowledge_revisions_latest_idx
    ON knowledge_source_revisions (source_id, captured_at DESC, id DESC);
