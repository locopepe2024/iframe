CREATE TABLE IF NOT EXISTS knowledge_schema_versions (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_collections (
    id uuid PRIMARY KEY,
    scope text NOT NULL CHECK (scope IN ('public_reference', 'owner', 'project')),
    owner_profile_id text,
    project_id text,
    name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    domain text NOT NULL CHECK (length(trim(domain)) BETWEEN 1 AND 80),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT knowledge_collection_scope CHECK (
        (scope = 'public_reference' AND owner_profile_id IS NULL AND project_id IS NULL)
        OR (scope = 'owner' AND owner_profile_id IS NOT NULL AND project_id IS NULL)
        OR (scope = 'project' AND owner_profile_id IS NOT NULL AND project_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS knowledge_collections_owner_idx
    ON knowledge_collections (owner_profile_id, scope, status);

CREATE TABLE IF NOT EXISTS knowledge_sources (
    id uuid PRIMARY KEY,
    collection_id uuid NOT NULL REFERENCES knowledge_collections(id),
    source_uri text NOT NULL,
    title text NOT NULL,
    source_type text NOT NULL,
    rights_status text NOT NULL DEFAULT 'unknown',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (collection_id, source_uri)
);

CREATE TABLE IF NOT EXISTS knowledge_source_revisions (
    id uuid PRIMARY KEY,
    source_id uuid NOT NULL REFERENCES knowledge_sources(id),
    raw_sha256 char(64) NOT NULL,
    raw_object_key text NOT NULL,
    capture_status text NOT NULL CHECK (capture_status IN ('captured', 'partial', 'failed')),
    captured_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_id, raw_sha256)
);

CREATE TABLE IF NOT EXISTS knowledge_content_units (
    id uuid PRIMARY KEY,
    source_revision_id uuid NOT NULL REFERENCES knowledge_source_revisions(id),
    kind text NOT NULL CHECK (kind IN ('text', 'image', 'table', 'video_segment')),
    locator text NOT NULL,
    body text,
    asset_key text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_personal_overlays (
    id uuid PRIMARY KEY,
    collection_id uuid NOT NULL REFERENCES knowledge_collections(id),
    owner_profile_id text NOT NULL,
    public_unit_id uuid REFERENCES knowledge_content_units(id),
    body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 20000),
    provenance_type text NOT NULL CHECK (provenance_type IN ('source_quote', 'user_observation', 'unverified_claim')),
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_publications (
    id uuid PRIMARY KEY,
    collection_id uuid NOT NULL REFERENCES knowledge_collections(id),
    source_revision_id uuid NOT NULL REFERENCES knowledge_source_revisions(id),
    curator_id text NOT NULL,
    rights_decision text NOT NULL,
    status text NOT NULL CHECK (status IN ('published', 'retired')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_publications_current_idx
    ON knowledge_publications (collection_id, source_revision_id, created_at DESC);
