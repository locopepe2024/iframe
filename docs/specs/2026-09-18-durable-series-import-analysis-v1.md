# Durable Series Import Analysis V1

Status: implemented and locally verified on 2026-09-18.

## Observed

- A 36 KB Markdown import calls `POST /series/import/preview` synchronously.
- Production Nginx closes that request after about 60 seconds (`499`) while the
  upstream LLM call continues in the backend executor.
- Repeated clicks submit additional paid model calls because preview work has no
  durable task identity.
- Preview returns an `import_id`, but the frontend confirm request sends a
  missing `text` field instead of that identifier.

## Contract

- File upload returns a durable owner-scoped job immediately.
- The client polls job status without an overall analysis deadline.
- Identical owner/file/episode-count/model requests reuse a running or completed
  job and do not resubmit the provider call.
- Successful preview stores the source text under the iFrame data directory and
  returns an opaque `import_id`.
- Confirm resolves `import_id` only for its owner and deletes the stored source
  only after series creation succeeds.
- Existing direct-text confirm remains as a compatibility fallback.

## Evidence Limit

Tests prove request deduplication, polling, owner isolation, and persistent text
handoff. They do not prove the model's episode boundaries are editorially good.

## Verification

- `python -m pytest tests/test_series_import_jobs.py tests/test_extraction_jobs.py tests/test_multi_user_boundary.py tests/test_series.py -q`
  - 47 passed
- Import, storyboard, and entity polling tests
  - 8 passed
- `npm run typecheck`
  - passed
- `DOCKER_BUILD=true NEXT_PUBLIC_API_URL=https://garage.uniart.fun npm run build`
  - passed
