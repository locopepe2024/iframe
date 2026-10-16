# iFrame catalog, media, and asset scope audit summary

Date: 2026-10-15
Status: pre-integration audit snapshot; resume after the pending PRs merge.

## Baseline and evidence boundary

- Reviewed GitHub `main` at `ae16fa0e5a5cad1b3754134e7b99dfc74ead447c` in a clean worktree. This document does not assert that later PRs or production contain these changes.
- At review time, the production host checkout, API image label, and static manifest reported `f87258fdaa27fbdc52c18739f536bec4afd26bf5`. The production-compatible source audit in PR #117 compared an earlier main revision (`41953a0e`): 101 differing paths and 11 main-only paths. Recompute that comparison against the eventual release commit.
- Open scope-related PRs at this snapshot: #121 (shot asset index and submission), #122 (context audit), #123 (storyboard production context), #124 (polished prompt versus style/lighting field synchronization), and #125 (bounded shot-context JSON and source lineage). Other PRs may follow. Their descriptions and passing CI are not evidence that their code is merged or production-active.
- Focused tests on the reviewed main: 92 passed across provider profiles/catalogs, Assembly selection/audio, owned media, video posters, media tools, and release gates. This is local test evidence, not production validation.

## Observed findings

### F1. Public static route bypasses private media guard (deployment blocker)

Code fact: `src/apps/comic_gen/api.py` mounts all of `output` at `/files` and blocks selected `/files/<area>/` prefixes by checking the request path before `StaticFiles` resolves it. The owner media registry and owner files live below `output/users`.

Runtime observation in a local `TestClient` against the actual app: an unauthenticated GET for `/files/users/<owner-key>/studio/probe.txt` returned 404; `/files//users/<owner-key>/studio/probe.txt` returned 200 with the private test file. The second path misses the prefix guard and is normalized by the static-file handler. The owner key is an identifier, not an authorization check. The response also receives a public cache header.

Direct implication: the FastAPI application does not enforce the documented owner/signed-media boundary for every path to private files. Whether the production reverse proxy normalizes this exact URL before forwarding is not yet proven and must not be used as a substitute for an application fix.

Verification after a fix: exercise direct and repeated-slash paths against owner files and the media-registry database without credentials; both must fail. Authenticated owner routes and valid signed provider routes must still serve only their authorized files. Test the externally served production route after deployment without using real private content.

### F2. `ImageVariant` can overwrite an explicit storage key (storage cutover blocker)

Code fact: `src/apps/comic_gen/models.py` `ImageVariant.normalize_storage_key` copies `url` into `storage_key` when a non-HTTP URL differs from an existing key. Local model construction with `url="users/owner/studio/image.png"` and `storage_key="cos/owner/image.png"` yielded `storage_key="users/owner/studio/image.png"`.

Direct implication: deserializing or updating a variant can replace its durable storage locator with a delivery/compatibility path. This is incompatible with moving an owner's material between local, COS, and OSS while retaining stable identity.

Verification after a fix: distinguish legacy records with no storage key from records with an explicit key; preserve explicit keys regardless of URL projection. Test Pydantic load, assignment, API response signing, save/reload, and legacy migration for local and object-store locators.

### F3. Media identity documents assign different authority

`docs/specs/2026-10-07-unified-workbench-media-contract-v1.md` defines `media_id` as immutable material identity and `storage_key` as a server locator. `docs/specs/2026-10-07-asset-variant-storage-key-contract-v1.md` calls `storage_key` the variant's one durable media identity. Current `ImageVariant` accepts optional `media_id` and `storage_key`; the owner registry maps a `media_id` to a unique storage key, but registration is partial and legacy URL paths remain.

Decision needed before migration: state one final authority (`media_id` for material identity, asset/variant IDs for semantic bindings, storage key for backend location), and label the storage-key-only rule as a compatibility phase if retained. Specify how an object move changes its locator without changing material identity, and which records require a migration report rather than guessing.

### F4. Storage policy documents conflict and directory ownership is incomplete

`docs/specs/managed-cos-storage-v1.md` makes managed COS mandatory durable storage and local disk scratch only. `docs/specs/2026-10-15-provider-storage-consolidation.md` plans explicit local/COS/OSS selection. The current code still uses many literal `output` paths across Studio, Playground, media registry, thumbnails, Assembly, and API mounts; OSS selection retains configuration-driven behavior. The latter document explicitly schedules media-root and storage-adapter work after the already merged provider/media-URL slices.

Decision needed: identify the current product storage policy and mark the superseded document or the scope in which it still applies. Define one server-owned media root and resolver, with separate storage backend selection, scratch/cache paths, owner registry, delivery URL, retention, and rollback behavior. Do not interpret the neutral provider media URL setting as a completed storage migration.

### F5. Catalog and adapter authority remains split

Code fact: the generated model catalog and provider registry describe capabilities and family routing; `/config/models?provider=...` fetches an owner-specific provider catalog; the frontend still uses a legacy runtime UniArt snapshot and its default `/config/models` refresh path. GreenA retains `nsfw/` model IDs and database keys for compatibility. The provider-profile document describes this as a partial slice, without a global provider-selector cutover or an in-flight task configuration snapshot.

Direct implication: a model appearing in one catalog does not prove it is selectable on every surface or executable with the current owner's credentials. For each model, audit the exact chain: canonical ID and alias -> capability/mode -> UI availability -> selected provider profile -> adapter -> accepted task snapshot -> polling after profile changes. Explicit catalog URL validation also permits arbitrary HTTP(S) hosts and follows the standard redirect behavior; internal-address reachability and deployment egress controls remain unverified.

### F6. Candidate visibility is not project asset membership

`docs/specs/2026-09-24-asset-material-workspace-index-v1.md` and `2026-10-06-asset-scope-cover-validity-uniqueness-v1.md` distinguish a personal candidate index from project/episode assets and inherited series assets. On the reviewed main, broad resolver paths still include owner-global assets. PRs #121 and #123 aim to narrow shot picking/submission and storyboard analysis/rendering respectively; neither establishes the target placement table, pinned project binding, workspace revision, or historical reference migration.

After those PRs merge, test project and series visibility, explicit import/fork, same-name and same-ID collisions, stale shot references, task inputs, and cross-owner access. Keep a reusable candidate picker distinct from the project execution index. Confirmed shots/tasks must not acquire a newly visible global candidate through name or fallback resolution.

### F7. Storyboard frames and Shot Design need one explicit handoff

Code fact: `StoryboardFrame.shot_id` can identify a confirmed shooting-plan shot, and `StoryboardReferencePackage` has first-frame, last-frame, reference, revision, and confirmation fields. `StoryboardComposer` can render/upload a frame image. It also has a manual action that extracts the preceding frame's **selected completed video** last frame and attaches that image as the current frame's selected rendered-image variant. This establishes a possible visual handoff; it does not prove that the two shots share a location, time, camera view, action state, or that the extracted image is a suitable opening composition.

Code fact: Studio Shot Design currently exposes `t2i_i2v` (selected/generated image as one I2V input) and `direct_r2v` (reference images or video according to model). Its `createVideoTask` calls submit an `image_url` for I2V or reference URLs for R2V. The UniArt adapter accepts a pair of `first_frame` and `last_frame` inputs, and Playground F2V submits exactly two images; the inspected Studio shot submission does not pass that pair. A stored `last_frame_url` in the reference package is therefore not evidence that Studio is using first/last-frame generation.

Target ordering to audit: confirmed plan shot and transition intent -> Storyboard design of this shot's `state_in`, visual first frame, optional intended `state_out`/last frame, and references -> Shot Design prompt, mode, model, and submission -> selected video result. After a prior video is selected and completed, its extracted tail can become a **candidate** for the next Storyboard first frame. This is an iterative dependency, not a reason to regenerate or silently replace an already confirmed next-shot frame. A cut to a new angle/location may need a newly composed first frame that preserves state without copying identical pixels.

| Studio mode / entry | Intended condition and input authority | Current evidence and gap |
| --- | --- | --- |
| First frame + I2V in Shot Design | This shot has one reviewed opening composition at 0.00 s; motion should start from that exact image. Storyboard supplies a selected frame or explicitly adopted prior-tail candidate. | `t2i_i2v` submits the selected image as `image_url`. Verify reference provenance, shot/context revision, and final provider payload. |
| First + last frame + I2V in Shot Design (target) | Both **this shot's** opening and ending compositions are deliberately fixed, the model supports a two-frame mode, and spatial/action continuity between them is feasible. The prior shot's tail may supply this shot's first frame, never its last frame by default. | Reference-package fields and UniArt/Playground transport exist, but Studio submission lacks a first/last pair. Add a distinct capability-gated entry and task snapshot before calling it supported in Studio. |
| R2V in Shot Design | Reference media constrain character, costume, setting, or motion while the shot's exact opening/ending image is not fixed; each selected model's reference kinds and limits apply. | `direct_r2v` submits model-specific reference URLs. A reference image is not automatically a first frame. Verify shot-only versus reusable asset scope and ordered references. |

The accepted `2026-10-07-storyboard-shot-design-boundary-v1.md` already lists first/last-frame as a user-facing Shot Design mode and requires confirmed Storyboard frames plus the consumed reference revision. That is a product contract, while the inspected Studio submission currently exposes only the two tabs above. The audit must close this implementation gap rather than treating a saved `last_frame_url` as proof of F2V execution.

#### H3, Seedance, and Wan interface audit

| Model path | Code/catalog evidence at `ae16fa0e` | Required post-merge check |
| --- | --- | --- |
| UniArt H3 (`uniart/minimax-h3-vip`) | Catalog declares `f2v`. `UniArtVideoModel` maps an ordered first/last pair to `content` roles `first_frame`/`last_frame` and `frames2video` mode. A unit test asserts the outbound shape for H3. | Verify the live owner catalog still exposes this exact SKU/mode; check duration, resolution, ratio, input media URLs, provider acceptance, task polling, and output. The local adapter test does not prove supplier acceptance. |
| UniArt Seedance (`uniart/seedance-2.0-vip`, `seedance-2.5-vip`, and any other advertised SKU) | Static catalog declares `f2v` for these entries; the same UniArt adapter builds the pair. | Check each exact SKU independently against its live capability/parameter response and a controlled provider request. Do not infer that every Seedance alias or route has the same F2V contract. |
| DashScope Wan (`wan2.7-i2v` and related versions) | Wan 2.7 catalog prose mentions first/last-frame support, but its structured capability is only `i2v`; the inspected Wan adapter resolves one `img_url` and sends one I2V image. It does not consume `last_frame`. GreenA `nsfw/wan3.0` similarly sends a reference-image list, not typed first/last roles. | Verify the authoritative endpoint, supported model versions, required field names and mode, limits, and response behavior before advertising F2V. Add a distinct adapter branch and payload tests only for versions verified to support it; never pass two generic reference images and label that F2V. |

For all three, mode availability should be the intersection of the model's verified capability, the selected owner's live catalog/profile, the adapter's implemented payload, and the Studio entry. The task must persist the concrete mode, ordered first/last `media_id`s and source revisions. A provider rejection must surface as a failed task without silently falling back to I2V or R2V. Keep reference-image ordering and prompt-structure rules separate from first/last-frame roles.

Post-merge continuity checks: same-moment cut, new camera angle, location change within one time continuity state, explicit time jump, and action/motion continuation. Compare prior selected video's actual end state with the next shot's reviewed `state_in` (person position/posture, held props, movement direction, place/time light). Treat missing evidence as `not_assessable`; do not infer continuity from adjacent array positions or matching image URLs. Track source video task/take ID, extracted-frame `media_id`, destination frame/shot ID, selected variant, and revisions so a changed prior take marks only dependent candidates stale. Preview the exact media and prompt snapshot before human submission, then compare it with the provider payload.

### F8. Polished prompt and editable shot fields must have one submitted truth

PR #124 is reported as changing the polish/edit flow so that later style or lighting edits update the visible body, the body and polish state save in order with retry after failure, and first-frame/video submissions use that body while preserving H3 audio and dialogue. The reported verification is 1183 local backend tests, 23 related frontend tests, typecheck, and build; CI was still running and the PR was unmerged at the time of this note. These are PR claims pending post-merge code and payload review.

Audit after merge: start with a polished shot, edit style then lighting then the prompt body, save, reload, and submit both first-frame and video paths. Compare the visible adopted body, persisted body/optimization marker, preview, and actual adapter payload; each should reflect the same revision without hidden suffixes or stale field reapplication. Repeat with save failure/retry, concurrent edits, model switch, H3 structured prompt, dialogue, and audio. Define which operation owns a field after a manual text edit so an automatic synchronization cannot silently replace deliberate wording.

### F9. Shot-context projection must preserve JSON and provenance

PR #125 is reported as fixing incomplete JSON caused by truncating long context, validating shot identity, retaining version information already present in the snapshot, and leaving unavailable source fields explicitly empty. The reported local backend regression is 1193 passed; GitHub CI was still running and the PR was unmerged at the time of this note. These are PR claims pending post-merge code review.

Audit after merge: test oversized episode/shot context at the projection boundary and parse the exact outbound JSON, including after any length budget is applied. Confirm that the requested project, frame, and plan shot IDs refer to the same current shot; a mismatch must fail or report a scoped missing link rather than borrowing another shot. Compare source, Director, plan, style, asset, and continuity revisions before/after projection. Existing snapshot values must survive; missing lineage must remain `null`/absent with a stated meaning, never be invented from the latest unrelated version. Verify that the optimizer receives the same bounded projection shown in pre-submit diagnostics and that truncation does not drop a required identity or continuity field.

## Post-merge audit sequence

1. Pin the new full `main` SHA; enumerate merged PRs and review their combined diff. Recompute the production/source comparison against that exact commit and preserve production-only behavior before preparing a release.
2. Resolve F1 and F2 with failing regression tests first. Recheck public routes, owner identity, URL renewal, storage-key load/save behavior, and media registry access through the actual app.
3. Reconcile the catalog and adapter path end to end, including legacy IDs, owner profile changes, task polling, explicit catalog availability, and nonpublic network targets.
4. Select and document the authoritative media identity and storage policy. Audit every read/write path for local/COS/OSS locators, directory roots, previews, downloads, provider URLs, thumbnails, Assembly, recovery, and deletion/retention.
5. Audit personal, series, project, episode, and shot asset scopes after #121/#123 and later PRs. Verify candidate discovery, project membership, selected variants, pinned references, and historical records separately.
6. Trace plan shot -> Storyboard first/last frame and references -> Shot Design I2V/F2V/R2V -> selected video -> next-shot candidate, including H3/Seedance/Wan exact-SKU capability and payload checks, revision staleness, and visual continuity. Do not treat the existing Playground F2V path as a Studio entry.
7. Recheck #124's polished-body, style/lighting, save/retry, and first-frame/video submission contract against persisted state and final provider payload, including H3 audio/dialogue preservation.
8. Recheck #125's bounded shot-context JSON, identity linkage, and provenance against the actual optimizer request; include an oversized context and missing-source fixture.
9. Only then update the release gate to accept a pinned reviewed `main` commit, run isolated writable candidate startup/data checks, and perform production smoke tests with rollback retained. Local CI or a successful static build alone is insufficient.

## Current disposition

No code fix, PR merge, deployment, or production media access is part of this summary. F1 and F2 block release; F3-F9 define the integration audit and design decisions to close after the pending PRs merge.
