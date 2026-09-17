# Recreation media library v1

Scope: expose existing owner-scoped recreation media through an asset library section. Keep stable media IDs and provenance in the recreation store; do not copy frames into character/scene/prop records.

Code facts: `/recreation/media` supports name substring, kind, project and bounded pagination; media paths are signed by the existing authenticated API. Existing asset library aggregates Studio semantic assets client-side.

Implementation: separate library sections for semantic assets and recreation media; server-side filters, 24-record pages, lazy image previews, selected-item video playback, source project and lineage detail. Discard stale responses after filters change; preserve loaded pages on pagination failure and allow retry. No mutation or generation in this slice.

Success criteria: switching library sections exposes media; query/kind/project filters reset pagination; load more retains unique media IDs; stale responses cannot replace new search results; failures allow retry; preview shows signed URL and available provenance without rewriting identity. Existing asset library behavior continues to pass tests.

Validation: frontend typecheck; focused library UI tests including request races and pagination failure; recreation backend tests for existing owner/search contract. Deployment and merge remain with the version administrator via PR.

Limit: offset pagination may shift if media are concurrently indexed; deduplicate loaded IDs, refresh to obtain a new list. No semantic/vector search, tagging or reference-editing pipeline yet.

Validation completed: frontend typecheck passed; 5 focused library UI tests passed; existing recreation backend suite 13 passed / 1 skipped. Used `/private/tmp/lumenx-regression-env/bin/python`; system Python lacks Pillow. No production deployment or paid generation was performed. Secret-pattern checks found no matches in changed source files; pre-existing repository matches are outside this change.
