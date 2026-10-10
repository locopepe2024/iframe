# Script, Plan, Asset, and Material Identity v1

Status: proposed cross-stage contract; no runtime migration in this document.
Date: 2026-10-10

This is the common identity glossary for Script, Director shooting plan, Assets,
Storyboard, and Shot Design. It refines the asset revision and scope contracts
from 2026-10-06 and the shooting-plan and storyboard boundary contracts. When
an older document uses `scene_id` or "revision" without a namespace, use the
definitions below. Existing JSON field names remain compatibility names until
an explicit migration is implemented.

## Observed Code Facts

- A `Script` is the persisted episode/project record. Its source text has a
  `source_revision` and append-only `source_revisions`; the source revision ID
  includes a content hash. `Series` owns a separate shared asset collection.
- `DirectorShootingPlanRevision` stores a confirmed plan snapshot, revision,
  hash, and confirmation time. Its scene, beat, and shot IDs identify plan
  nodes. Plan `scene_asset_id` and `prop_ids` can refer to semantic assets. A
  cast binding carries `person_id` and optional era/look IDs. The legacy shot
  `character_ids` field is not typed by its schema; projection combines it
  with cast `person_id` values before attempting asset resolution.
- An effective episode asset view merges episode-local, series, and (in some
  resolver paths) personal/global assets by `asset.id`. The project response
  exposes local and series assets with a `source` label. The project Assets
  view does not create another canonical asset ID. Current same-ID precedence
  is a compatibility resolution rule, not proof of one authoritative owner.
- An image `ImageVariant` has `id`, material locator/storage key, and optional
  owner-scoped `media_id`. The media registry exists, but legacy variants may
  lack `media_id`; a delivery URL is not an identity. A monotonic, confirmed
  asset revision is still a target contract, not a current model field.
- `StoryboardFrame.scene_id` currently means a Scene **asset** ID, while a
  shooting-plan scene's `scene_id` means a **plan node** ID. `shot_id` on a
  frame may point back to a confirmed plan shot. A frame also has its own
  shot-scoped reference package and generated image/first-frame selections.
- Asset sync projects the latest confirmed plan into episode context and
  bindings. Each `EpisodeAssetBinding` stores asset type/ID, source plan
  revision/hash, optional selected variant ID, and status. It does not contain
  an asset revision. Sync does not create or overwrite assets. When a scene has
  no `scene_asset_id`, current sync writes its plan `scene_id` into a Scene
  `asset_id` binding and reports it unresolved unless an asset happens to have
  that ID. The asset-context prompt also matches either ID; both paths mix
  plan and asset namespaces.

## Object and Identity Registry

| Object | Canonical identity and scope | Revision or child identity | May be reused? |
| --- | --- | --- | --- |
| Script source | `project_id`/episode ID; belongs to one owner, optionally a series | `(project_id, source_revision)` and `source_revision_id` | Source evidence can inform many downstream objects; it is not an asset. |
| Director story person | Current: `(project_id, director_profile_revision, person_id)` within an episode story map; target: stable series-scoped person identity with explicit cross-episode mapping | Director profile revision records the reviewed mapping | One narrative person can have multiple era looks. Cross-episode stability is a product requirement, not yet a guaranteed database identity. |
| Shooting plan | `(project_id, plan_revision)`; one episode | Draft revision and immutable confirmed revision/hash are distinct | Plan revisions can be restored into a new draft; old snapshots remain history. |
| Plan scene/beat/shot | `(project_id, plan_revision, scene_id/beat_id/shot_id)` for a confirmed snapshot | Target: preserve node ID across revisions only when reviewed as the same planned unit; current validation enforces uniqueness inside one plan, not continuity across revisions | A node is a planning unit, not a reusable Scene asset. |
| Semantic asset | Target: `(owner, asset_type, asset_id)` with explicit placement in project, series, or personal library | Target: immutable asset revisions under the same ID | Yes; series placement shares one asset across episodes. |
| Asset variant binding | `(asset_type, asset_id, variant_id)` plus authoritative owner | Target asset revision records membership, role, and current choice | Yes within the asset; a fork must get new asset and variant-binding IDs. |
| Material | Owner-scoped `media_id` for retained bytes/provenance; legacy storage key where not migrated | New bytes imply new material ID | One material may serve multiple asset bindings or shots. |
| Episode asset binding | `(project_id, asset_type, asset_id)` in the current handoff | Carries source plan revision/hash and optional variant ID | It is a projection/decision, not another asset. |
| Storyboard frame | `(project_id, frame_id)`; optional link to plan `shot_id` | Current `reference_package.revision`; generated outputs/takes have their own IDs | Frame is shot-scoped, not a library asset. |
| Shot keyframe/reference | `(project_id, frame_id, role, media_id)` when retained; legacy URL until migrated | Role can be first, last, environment, effect, upload, or Director snapshot | Default scope is this shot only. Explicit promotion creates or binds a reusable asset. |

`schema_version` versions a payload format, not creative content. Name, URL,
thumbnail, array position, and display cover cannot substitute for any ID above.
The target asset key includes owner; current JSON does not enforce canonical
cross-container uniqueness, so legacy collisions need source scope/container ID
to disambiguate before migration.

## Scope and Reference Rules

1. **Project/episode asset:** a local `Character`, `Scene`, or `Prop` stored on
   `Script`. A project Assets row showing this asset has the same `asset_id`.
2. **Series shared asset:** stored once on `Series`; each episode view may show
   it with the same `asset_id` and `source=series`. Editing the shared asset
   affects the current shared record; an accepted shot must eventually pin an
   exact asset revision/variant to avoid silent visual drift.
3. **Personal/global asset:** owned by a user, not by a series. Picker visibility
   is not placement in a project. Current resolver and project-response paths
   differ on whether it appears without import; the target contract requires
   explicit use/binding or placement, with the source identity retained.
4. **Move/share versus fork:** moving placement or inheriting a series asset
   keeps the asset ID. A fork or deep-copy import makes a **new semantic
   asset ID** and records source lineage. Current copy paths may copy child
   variant IDs; that is a migration gap, not the target identity rule.
5. **Plan references:** a plan scene's `scene_id` identifies the planned scene.
   Its `scene_asset_id`, or a shot's `scene_binding.scene_asset_id`, identifies
   a reusable Scene asset. Legacy `shot.character_ids` needs a typed migration:
   current projection may treat its values as narrative people, while other
   frame paths use Character asset IDs. `scene/shot.prop_ids` and
   `prop_bindings.prop_id` identify Prop assets.
   `cast_bindings.person_id` identifies a narrative person and resolves through
   a reviewed person-to-character-asset mapping. It must not be silently
   equated to `asset_id` even when legacy values happen to match.
6. **Storyboard compatibility:** `StoryboardFrame.scene_id` still holds an
   asset ID. New contracts should spell this `scene_asset_id` and separately
   carry `plan_scene_id`; do not infer one from the other. Frame `shot_id` is
   the plan-shot link when present, not the frame's own ID.
7. **Unbound scene demand:** when neither the plan scene nor its relevant shot
   binding supplies `scene_asset_id`, the scene remains a
   `(project_id, plan_revision, plan_scene_id)` requirement awaiting an asset
   choice or creation. It must not produce an `EpisodeAssetBinding.asset_id`.
   An accidental string match between plan and asset IDs is never a binding.

## Revision Dependencies

```text
Script source revision -> Director profile revision -> shooting plan revision
                                                     -> episode asset handoff
                                                     -> Storyboard reference-package revision
                                                     -> Shot Design task/take

Semantic asset ID -> asset revision (target) -> variant binding -> media ID
                 \-> plan/handoff references by ID
```

- A text change advances the Script source revision; a plan records the
  source/Director/style lineage it reviewed. A plan edit advances the draft
  revision; confirmation appends a confirmed plan revision only when content
  changes. Confirming a plan does not mutate asset or storyboard revisions.
- A change of visual material, current variant, or role belongs to an asset
  revision **under the same asset ID** in the target model. Current code often
  appends/selects variants immediately and has no committed asset revision.
  Changing an asset's image does not rewrite a confirmed plan.
- Episode handoff/sync cites the confirmed plan revision/hash. It recomputes
  desired asset bindings, reuses unchanged bindings, and marks missing or
  changed ones for review. It is not an asset revision and does not prove that
  the selected material is confirmed or available.
- An accepted shot or paid generation request must record the exact asset
  revision and variant/material IDs it consumed in the target model. A later
  asset default change affects only future unpinned choices. Current frame
  fields and task lineage implement parts of this, not a complete cross-stage
  revision lock.
- Restoring an old source, plan, or asset revision creates a **new** current
  revision after review; it never edits historical snapshots in place.

## Identity Lifecycle Decisions

| User decision | ID effect | Revision/reference effect |
| --- | --- | --- |
| Same person/place/prop, new style or all images rejected | Keep `asset_id`; discard/archive active visual selections, keep retained material history | New asset revision in target model; plan asset references stay stable. |
| Material is replaced or regenerated | New `media_id`; new variant binding if accepted | Asset ID stays stable. Shot-pinned old material does not change silently. |
| Plan no longer needs an asset | No new asset ID; retire placement/delete only after explicit impact review | New plan revision omits reference; old plan remains auditable. |
| Different semantic person/place/prop replaces the old one | New `asset_id`, or choose another existing asset ID | Preview and explicitly rebind affected plan draft/shot references; confirm a new plan revision. |
| Force-delete a referenced asset | Old asset ID is retired/unresolvable, never reused for a different object | Historical plan IDs remain; current bindings become missing/stale and require explicit replacement. Current runtime clears frame/current binding refs but has incomplete historical resolution UI. |

An empty asset envelope is valid. "Delete all pictures but keep this character"
is an asset-visual reset, not semantic asset deletion. A shot-local keyframe
can be regenerated independently of either operation.

## Shot Keyframe Boundary

A Storyboard first frame or last frame is one concrete composition for one
shot: cast pose and position, scene geometry/placeholders, camera framing,
lighting, atmosphere, and transient effects. It is a **shot-scoped artifact**
and may be retained as a material. It is not automatically a Character, Scene,
or Prop asset, even if it depicts all three. The source assets and exact
variants used to make it should be recorded as lineage, without absorbing the
whole composition into any one source asset.

| Result | Default owner | Reuse decision |
| --- | --- | --- |
| Character look/reference sheet or persistent prop/scene design | Semantic asset and its variant bindings, after explicit confirmation | Reusable in later shots/episodes under its placement rules. |
| First/last frame, 3D Director snapshot, blocking render, lighting test, temporary placeholder | Storyboard frame/reference package or generation task | Shot-scoped; replacing it changes that shot's reference package, not an asset ID. |
| A shot frame later chosen as reusable environment/look/reference | Retained material first; explicit `Save as asset` or `Add variant to asset` | New asset only for a new semantic object; otherwise new variant on an existing asset. No automatic promotion. |

A placeholder records its intended role and unresolved source reference; it
does not invent an asset ID. Spatial arrangement and lighting are shot or
scene state unless the user deliberately saves a reusable set/template with
its own named product contract. A reusable template is not silently a Scene
asset. First/last-frame confirmation advances the shot reference-package
revision; an asset revision advances only if a user separately confirms an
asset variant/selection change.

## Current Gaps and Verification

- The `person_id` to Character-asset mapping may be absent; current sync can
  report unresolved characters. The story map validates unique `person_id`
  values in one map, but there is no verified series-wide person registry or
  enforced cross-episode continuity. Name matching must not manufacture identity.
- Plan `scene_id` and frame `scene_id` share a name despite different domains.
  Current sync substitutes plan `scene_id` for a missing Scene asset ID, and
  asset-context lookup accepts both. Fix those boundaries before interpreting
  existing unresolved Scene bindings as real asset references; add typed
  names at API/view boundaries before any persistent migration.
- Plan node stability across revisions is a target rule. The validator proves
  uniqueness within a plan only; a restore/regeneration may need reviewed
  old-to-new node mapping before references can follow it.
- Asset revisions, placement IDs, confirmed variant membership, and exact
  asset-revision pins remain target contracts. Existing `media_id` coverage is
  partial for legacy data. Do not label a legacy selected variant "confirmed".
- Force deletion must remain possible, but the impact preview should list
  plan revisions, current bindings, and shot references. Bulk replacement
  must require an explicit old-to-new typed ID mapping and create a new plan
  revision; it cannot rewrite confirmed history.

Acceptance for future implementation: style reset preserves asset IDs;
share/move preserves ID while fork changes it; plan scene IDs never resolve as
Scene assets by accident; unresolved people stay visible; a one-off keyframe
does not appear in Assets without promotion; an accepted shot stays pinned to
its exact material when an asset's default changes.

## What Would Verify It

- Trace one plan scene with no Scene asset through sync and storyboard lookup;
  verify it remains an unbound plan requirement even if an unrelated Scene
  asset has the same string ID.
- Compare confirmed profile and plan revisions across edits, restores, and
  episodes to establish which person and plan-node IDs actually persist.
- Audit legacy `shot.character_ids`, variant `media_id` coverage, and accepted
  shot/task lineage before migrating fields or promising exact revision pins.
