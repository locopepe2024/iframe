# Character design save latency

## Observed

- User reports 20–30 seconds between saving a design and completion.
- Code fact: the original save persisted asset attributes, then rebuilt and signed the entire merged project, including cloud cover lookups for every visible asset.
- Production access log: one relevant successful save returned 1,071,369 bytes. The log did not record request duration.
- Read-only profiling of production data, in a separate process (not a measurement of the actual HTTP request):
  - 38,924,075-byte series store: JSON read 0.102 s, model validation 0.006 s, model dump 0.016 s, JSON encoding 0.184 s.
  - All-series asset revision scan on in-memory copies: 0.008 s.
  - Target merged project's Studio media projection: 0.036 s; cloud signing: 0.290 s.
  - Actual cover selection: 28 cloud HEAD checks, all thumbnail cache hits, 0.834 s total.
  - Same-volume temporary-file JSON dump, flush and fsync: 0.420 s. Temporary file automatically removed; live stores not changed.
  - Unauthenticated identity-service connectivity probe: 0.213 s. This does not measure an authenticated user's identity validation.

## Direct implication

Saving text unnecessarily depends on the full-project response and unrelated asset delivery operations. A design-only response removes those dependencies and reduces the response to the saved character's design and semantic asset revision. This is a bounded optimization, not proof of the reported delay's cause.

## Not yet proven

The 20–30-second delay was not reproduced end to end. The measurements above do not include live save-lock contention, authentication with the user's session, request queueing, browser transport, synchronous local-storage persistence, or rendering. They must not be added up and presented as measured save latency.

## Implementation

- Existing update-attributes callers retain the full merged-project response by default.
- Character design saves request `response_mode: "design"`, accepted only for a character update containing exactly `character_design`.
- Success is returned only after existing synchronous persistence completes. Response contains `project_id`, `asset_id`, `asset_revision`, and persisted `character_design`.
- Frontend merges only the saved design into the latest character state. In-flight generation results, covers, other assets, and newer asset revision numbers survive the save response.
- `Server-Timing` and content-free logs distinguish persistence/lock wait, response projection, identity resolution, and handler duration. Handler timing includes scheduling and overlaps persistence/response timing; these are not additive.
- Frontend and backend should be released together. No deployment performed as part of this change.

## Verification

- Regression coverage: persisted design-only response skips whole-project/cover building; legacy merged-project response remains; invalid design-only mutations rejected before saving; persistence failure returns an error; concurrent generation state survives frontend merge.
- For runtime acceptance after deployment: reproduce a save, inspect request total/transfer duration and `Server-Timing`, correlate server stage logs, and compare with the previous 20–30-second observation. Do not claim that observation is resolved before this check.
