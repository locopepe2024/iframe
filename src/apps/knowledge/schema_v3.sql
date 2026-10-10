CREATE TABLE IF NOT EXISTS knowledge_research_runs (
    id uuid PRIMARY KEY,
    owner_profile_id text NOT NULL,
    session_id text NOT NULL,
    query text NOT NULL,
    intent jsonb NOT NULL DEFAULT '{}'::jsonb,
    collection_id uuid NOT NULL REFERENCES knowledge_collections(id),
    status text NOT NULL CHECK (status IN ('discovering', 'awaiting_selection', 'capturing', 'ready', 'partial', 'failed')),
    candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS knowledge_research_runs_owner_idx
    ON knowledge_research_runs (owner_profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_capture_jobs (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES knowledge_research_runs(id),
    owner_profile_id text NOT NULL,
    source_url text NOT NULL,
    state text NOT NULL CHECK (state IN ('queued', 'running', 'ready', 'failed')),
    attempts integer NOT NULL DEFAULT 0,
    lease_until timestamptz,
    source_id uuid,
    revision_id uuid,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (run_id, source_url)
);
CREATE INDEX IF NOT EXISTS knowledge_capture_jobs_claim_idx
    ON knowledge_capture_jobs (state, lease_until, created_at);

CREATE TABLE IF NOT EXISTS knowledge_discovery_limits (
    key text PRIMARY KEY,
    day date NOT NULL,
    used integer NOT NULL,
    next_at timestamptz NOT NULL
);
