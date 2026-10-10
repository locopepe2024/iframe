# iFrame Knowledge: Agent Handoff and Acceptance v1

Date: 2026-10-10. Status: owner import/search API and explicit Playground Agent search deployed; collector and model-proposed tool loop pending. This is the short handoff for agents building collection, indexing, and domain workflows. The product rules remain in `2026-10-10-iframe-knowledge-platform-spec-v1.md`.

## Observed

- TencentDB PostgreSQL 16 is provisioned privately in Tokyo with migrations v1/v2; the deployed API connects through TLS. Private COS storage is configured with scoped credentials.
- The deployed API accepts owner collections and text/image/short-video source units, annotations and searches. An isolated candidate and the live localhost API passed two-identity HTTP tests of import, idempotency, media retrieval, type-filtered search and private isolation.
- There is no web crawler, model-proposed Agent tool loop or public curator API yet. The Playground Agent can perform user-enabled read-only search and persist returned citations. Existing Agent skills remain prompt instructions. The HTTP smoke did not test public publication.

## Direct implication

The next deliverable must be an API another Agent can call without database credentials. Every request uses the existing `require_user_context` identity; caller-supplied owner/scope fields cannot grant access. Uploaded source bytes and media must remain private, and a citation must identify an immutable source revision and unit locator.

## Interface standard for the first Agent handoff

- `POST /knowledge/collections` creates an owner collection; `GET /knowledge/collections` lists the owner's collections plus published public collections.
- `POST /knowledge/collections/{collection_id}/sources` accepts a source URI, title, rights status, and ordered units. Each unit has `kind` (`text`, `image`, `table`, `video_segment`), a stable `locator` (section/page or video time range), source text/caption, optional bounded base64 media, and optional labels/notes. The server checks collection ownership. It stores original submitted bytes, creates a content-addressed revision, and returns source/revision/unit IDs. Repeating the same submission returns the same revision.
- `GET /knowledge/sources/{source_id}` returns source metadata, exact revision and units only when the current owner may read them. `GET /knowledge/units/{unit_id}/media` serves a private media unit through the same authorization boundary.
- `POST /knowledge/search` accepts a bounded query and optional domain/kind/collection filters. It constrains visible source IDs in SQL before ranking and returns source title/URI, rights, collection layer, revision ID, unit ID, locator, excerpt, labels and annotations. Search output is source material, not verified truth or an instruction to the Agent.
- Public publication and project-scoped collections are separate curator/project contracts. Owner import cannot publish a source merely by choosing a public URL or adding a label.

All endpoints use the existing iFrame authentication context. The import request is JSON; for example:

```json
{
  "source_uri": "https://example.org/printing/report",
  "title": "Printing industry report",
  "source_type": "web",
  "rights_status": "licensed",
  "units": [
    {"kind": "text", "locator": "section:policy", "body": "...", "labels": ["policy"], "annotation": "Original source excerpt"},
    {"kind": "image", "locator": "figure:1", "body": "Original caption", "media_type": "image/png", "media_base64": "<base64 PNG bytes>", "labels": ["equipment"]},
    {"kind": "video_segment", "locator": "00:00:01-00:00:03", "body": "Production line", "media_type": "video/mp4", "media_base64": "<base64 MP4 bytes>"}
  ]
}
```

Response IDs are `source_id`, `revision_id`, and each unit's `id/kind/locator`; `created=false` means the exact submitted revision already exists. Query with `POST /knowledge/search` body `{"query":"printing","limit":10,"kind":"image"}`. An `upload:<id>` URI may identify user-provided material. Supported media types are PNG/JPEG/WebP and MP4/WebM. Each media unit is limited to 16 MiB, and all media in one source request to 32 MiB; the first slice accepts at most 100 units. `source_uri` records provenance and never causes a server-side fetch.

Private bytes use SHA-256 paths and never have a public file mount. The default single-host development backend requires `IFRAME_KNOWLEDGE_BLOB_ROOT`. Shared deployment uses `IFRAME_KNOWLEDGE_BLOB_BACKEND=cos` with `IFRAME_KNOWLEDGE_COS_REGION`, `IFRAME_KNOWLEDGE_COS_BUCKET`, `IFRAME_KNOWLEDGE_COS_SECRET_ID_FILE`, and `IFRAME_KNOWLEDGE_COS_SECRET_KEY_FILE`; the COS adapter writes private objects under `knowledge/`. COS provision and IAM scope passed; joint metadata/media backup and restore remain open. Do not run shared production ingestion in local mode.

An Agent can submit its own collected material through this contract, but the server does not fetch arbitrary URLs in this slice. `source_uri` is provenance, not a fetch command. For a web article, the collecting Agent must submit the actual text and media it has permission to store. Short video segments are supported within the upload limit; complete large videos need chunked object storage in a later slice.

## Acceptance matrix

1. Owner A uploads one article with text, image, and short video segment; returned IDs and locators remain stable across restart. Repeating identical content does not create another revision; changed content does.
2. A adds labels/notes. Querying a word in the article, caption, or annotation returns a citation to the correct unit. Query filters bound result count and preserve type/domain.
3. Owner B cannot import into, inspect, query, or download media from A's private collection. A and B can both query a curator-published public source; unpublished public sources are absent.
4. A client cannot send `scope`, `owner_profile_id`, arbitrary storage paths, oversized media, malformed base64, or unsupported media types to bypass the boundary. Invalid requests fail explicitly without partial metadata commits.
5. The API can be exercised with deterministic local fixtures and against a disposable PostgreSQL database. The shared host must use private persistent object storage before production media ingestion.

## Not yet proven

- Legal rights to capture any particular external article/image/video; `rights_status` records an assertion, not legal verification.
- Search quality for Chinese, finance, visual similarity, or all creative disciplines. Measure recall and citation accuracy with domain fixtures before claiming those capabilities.
- Restore of metadata and media together, multi-instance object access, COS credentials and worker restart behavior.

## Next development order

1. Implement the owner-scoped ingest/read/search API, private object store adapter and migration v2; test text/image/video and A/B isolation.
2. Apply migration on a disposable/shared database and run a real API smoke test; verify file persistence, TLS, and no cross-owner media access.
3. Move private bytes to a dedicated COS bucket before shared production ingestion; add bounded multipart/chunked media upload and restore test.
4. Add allowlisted web/PDF collectors as separate Agent tools with queued jobs, source policy and parser fixtures. Then add curator publication and project scope.
5. Expose `knowledge.search` and ingestion status through the Playground Agent tool loop, with citations and review before creative or finance drafts change.
