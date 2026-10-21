# iFrame H3 V2 migration

Source: UniArt maintained contract `docs/oran-h3-v2-public-endpoint-20261020.md`, local checkout `uniart-worktrees/oran-h3-v2-20261020` at ace0df6; source public endpoint https://uniart.fun/oran/h3/v2/videos. Captured 2026-10-21 in docs/1-api-reference. This is local source/document verification, not a fresh live capability check. Raw archive and Context Hub promotion remain outstanding (repo-only workflow).

## Scope and success criteria

- All new shared H3 creates use /oran/h3/v2/videos; never retry on V1 or substitute SKUs. Keep configured host and credentials.
- T2V uses text_to_video; I2V uses one first_frame/image2video; R2V uses omni_reference; F2V uses first_last_frame with two images. Frame modes use adaptive ratio, as required by the upstream contract, and UI communicates automatic frame ratio.
- Only V2 whitelisted fields enter the wire payload. Reject explicit unsupported seed and enabled watermark. Preserve the generated-audio toggle and forward explicit generate_audio=true/false (latest contract confirmed by the user). Prompt 1–7000 chars, duration 4–15 integer seconds, 720p/2k, up to 9/3/3 image/video/audio references.
- Persist API version per accepted batch task. Missing version means legacy V1 recovery. Use original version for resume without creating another task or reading old attachments.
- Keep editor @ binding; canonicalize only after media resolution. Preserve drafts and stable attachment identity.
- Discount V2 is documented enabled; VIP activation is not established. Do not silently replace VIP or change UniArt managed routing/pricing. Runtime catalog remains authoritative for SKU availability.

Affected boundaries: UniArt adapter, Playground generation/service persistence, UniArt catalog projection, composer frame-ratio controls, executable model YAML/generated mirrors, tests.

Verification: first reproduce all four wire modes and V2 recovery with mocked transport; targeted Python tests and compile; regenerate/validate catalog; frontend typecheck, full backend/frontend suites and build. Record baseline failures separately. No paid generation or production deployment in this slice.

## Consumer scope

Playground, Studio and Recreation all submit new H3 tasks through V2. Accepted historical tasks without API-version metadata retain V1 recovery. The earlier Playground-only scope is superseded by the user-requested shared-adapter migration.

## Verification results

- 80 targeted Python tests passed: all four Playground-to-wire modes, canonical mention conversion, V2 API version persistence across storage reload, no-resubmit recovery, legacy V1 recovery, and unchanged Studio submissions.
- Catalog regenerated; mirror validation passed. Python compile and whitespace checks passed.
- Frontend typecheck and production build passed; 10 targeted composer/history UI tests passed. Unit tests: 234 passed, four unrelated suites fail during import (`axios` request mock).
- Full backend run: 840 passed, 78 failed, 2 skipped. Pre-change baseline: 821 passed, 79 failed, 2 skipped. No newly failing test IDs; prior second-image I2V validation failure resolved. Full UI run: 43 failed / 308 passed, 25 errors; identical counts reproduced with pre-change composer/catalog. Errors include missing mocked BrainCircuit and unrelated series/media-input assertions.
- No production deployment or paid V2 request. Documentation reports Discount route enabled and VIP not activated in that release. Exact requested duration versus media duration remains an upstream observation limitation (4s requested / 3.75s measured in cited source), not verified by this client change.

## Shared-adapter expansion (user requested)

All new shared H3 creates now default to V2, including Studio and Recreation. V1 is recovery-only: accepted unversioned tasks query V1; new creates cannot opt back into V1. Studio and Recreation persist the accepted API version beside the task ID before polling. No SKU substitution or V1 fallback.

Preserve all existing audio controls and choices. Forward generate_audio=true/false to V2 without forcing a value. Recreation keeps its existing provider audio setting and independent assembly policy (silent/source/generated). Reject explicit seeds before paid tasks are created. Existing pending work is validated at the adapter boundary. Other provider families remain unchanged.

Affected additional paths: Studio models/pipeline, Recreation service, audio catalog projection, related contract and recovery tests. Preserve unrelated existing work in dirty Studio files; stage only this migration's hunks.

Audio evidence correction: the captured ace0df6 UniArt source rejects disabled audio; the user explicitly confirms the updated V2 supports disabling it. Implement the updated client contract and record this older-snapshot discrepancy; no live provider audio-output verification is claimed.

## Shared migration verification

- 125 targeted Python checks passed, 1 skipped; covers all four V2 modes with both audio values, Studio/Recreation acceptance and V1/V2 recovery, seed rejection, URL material transport and catalog controls.
- Full backend: 858 passed, 78 failed, 2 skipped; failed test IDs match the previous migration baseline (no newly failing IDs).
- Catalog regeneration/mirror validation, Python compilation, frontend typecheck and production build passed. Composer controls: 4 unit tests passed; composer and shot audio controls: 12 UI tests passed. Existing generatedAudio suite fails at import because its axios mock lacks interceptors.request (same baseline limitation).
- No deployment, push, paid generation or verification of live output audio was performed.
