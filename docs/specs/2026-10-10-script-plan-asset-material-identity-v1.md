# Script, Plan, Asset, and Material Identity v1

Status: cross-stage contract with partial runtime implementation.
Date: 2026-10-10

Implementation note (2026-10-10): shooting-plan asset sync now keeps an
unbound plan scene in `unresolved_bindings` with reason `scene_asset_unbound`
instead of substituting `scene_id` for `asset_id`. Scene asset-context lookup
matches only `scene_asset_id`. Previously persisted mistaken bindings become
stale on the next sync; historical plan snapshots are not rewritten. The
remaining identity rules below include target contracts.

Implementation note (2026-10-10, asset revisions): project, series, and
personal-library assets now persist semantic revision snapshots with explicit
`legacy_attached` versus `user_confirmed` status. Confirmation and restore
preserve the asset ID; restore creates a new current revision. Confirmed
storyboard reference packages and video tasks record asset revision, variant,
and available media/storage IDs. Old packages without pins remain legacy
records; legacy variants without `media_id` cannot claim complete material
identity. Generation still attaches variants before review, and project asset
details are the only direct confirmation UI.

The episode Assets prompt projection in the frontend also matches Scene assets
only by `scene_asset_id`; a coincidentally equal plan `scene_id` is not a match.

Implementation note (2026-10-10, shot Scene bindings): a projected shot carries
its own `scene_asset_id`, falling back to the plan scene's explicit
`scene_asset_id`. Sync collects all distinct Scene assets used by the shots and
returns unbound shots as typed requirements. Assets prompt lookup and
Storyboard shot matching use those explicit links; a plan-scene ID collision
does not establish a Scene asset relationship.

Implementation note (2026-10-10, shot context): projected
`EpisodeVisualShotContext.character_ids` now contains only Character asset IDs;
`person_ids` carries narrative cast identities. An unresolved cast person does
not become a Character asset reference. Legacy `DirectorPlanShot.character_ids`
still names Character assets and is not renamed in stored plans.

Implementation note (2026-10-10, series deletion): confirmed-plan reference
scanning now resolves cast `person_id` through the matching Director profile's
character variant mapping and explicit era choice, or the character's declared
base identity when that mapping is absent. A same-string `person_id` cannot
override a reviewed mapping to a different asset. Force deletion remains
available and retains plan history.

This is the common identity glossary for Script, Director shooting plan, Assets,
Storyboard, and Shot Design. It refines the asset revision and scope contracts
from 2026-10-06 and the shooting-plan and storyboard boundary contracts. When
an older document uses `scene_id` or "revision" without a namespace, use the
definitions below. Existing JSON field names remain compatibility names until
an explicit migration is implemented.

Implementation note (2026-10-11, Assets deletion refresh): after a successful
deletion, the Assets view invalidates its prior sync diff, context, bindings,
and series picker cache. An episode with a previously synced context reruns
the non-creating asset sync to project the retired mappings; an unsynced
episode only reads context. Project assets and series options are refreshed
independently. A failed refresh reports that deletion already succeeded and
does not restore stale plan state. Responses for an episode the user has left
are discarded. Confirmed plan snapshots and asset revision history are unchanged.

Implementation note (2026-10-11, asset naming): Scene and Prop detail views
expose the same rename control already used by Character assets. Renaming
updates the asset display name through the existing attribute endpoint; it does
not create an asset, change its ID, or alter shooting-plan bindings. Generated
placeholder names such as `道具 1` remain explicit user-editable names until
the user supplies a semantic name; the system does not infer one from a plan
ID or a similar asset name.

## Observed Code Facts

- A `Script` is the persisted episode/project record. Its source text has a
  `source_revision` and append-only `source_revisions`; the source revision ID
  includes a content hash. `Series` owns a separate shared asset collection.
- `DirectorShootingPlanRevision` stores a confirmed plan snapshot, revision,
  hash, and confirmation time. Its scene, beat, and shot IDs identify plan
  nodes. Plan `scene_asset_id` and `prop_ids` can refer to semantic assets. A
  cast binding carries `person_id` and optional era/look IDs. The plan shot's
  `character_ids` field is not typed by its schema, but the editor and plan
  validation treat its values as Character asset IDs. Earlier projection
  mixed those values with cast `person_id` values in one list.
- An effective episode asset view merges episode-local, series, and (in some
  resolver paths) personal/global assets by `asset.id`. The project response
  exposes local and series assets with a `source` label. The project Assets
  view does not create another canonical asset ID. Current same-ID precedence
  is a compatibility resolution rule, not proof of one authoritative owner.
- An image `ImageVariant` has `id`, material locator/storage key, and optional
  owner-scoped `media_id`. The media registry exists, but legacy variants may
  lack `media_id`; a delivery URL is not an identity. Assets now store monotonic
  revisions, with explicit confirmation status for each snapshot.
- `StoryboardFrame.scene_id` currently means a Scene **asset** ID, while a
  shooting-plan scene's `scene_id` means a **plan node** ID. `shot_id` on a
  frame may point back to a confirmed plan shot. A frame also has its own
  shot-scoped reference package and generated image/first-frame selections.
- Asset sync projects the latest confirmed plan into episode context and
  bindings. Each `EpisodeAssetBinding` stores asset type/ID, source plan
  revision/hash, optional selected variant ID, and status. It does not contain
  an asset revision. Sync does not create or overwrite assets. The earlier
  implementation wrote plan `scene_id` into a Scene `asset_id` binding when no
  `scene_asset_id` existed, and asset-context lookup accepted either ID.

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
   a reusable Scene asset. `shot.character_ids` and projected shot
   `character_ids` identify Character assets; projected shot `person_ids` and
   `cast_bindings.person_id` identify narrative people. `scene/shot.prop_ids` and
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

   An unbound scene requirement can be explicitly associated with an existing
   episode-visible Scene asset by its plan `scene_id` or `shot_id`. This choice
   is stored on the episode handoff, not written into the confirmed plan. It
   expires when the requirement or chosen asset disappears. A plan-provided
   `scene_asset_id` remains a separate source identity and uses the existing
   replacement binding path.

### Place and time continuity

Current runtime has no `place_continuity_id` or `time_continuity_id`.
`scene_asset_id` identifies reusable visual material; plan `scene_id`
identifies one planned scene. Neither establishes that different views show
the same physical street or occur during the same continuous dusk. Current
`location`, `time_anchor`, `time_of_day`, and shot `lighting` fields are text
descriptions and do not provide a reliable cross-scene join.

The target plan contract assigns a stable `place_continuity_id` to the
physical place shared by its views, and a `time_continuity_id` to one
continuous story interval. “青溪镇青石板长街” and “青溪镇粮铺门前” can have
different scene asset IDs and the same place ID. If their shots occur in one
黄昏 interval, they share a time ID. Neither ID creates or merges an asset.

The reviewed time interval records its story time, daylight phase, and
weather. Each reviewed place/time pair owns a lighting baseline: key light
source and world direction, color tone, and shadow direction. Shots with the
same pair inherit that baseline. A deliberate lighting difference records an
explicit override and reason. A confirmed plan revision pins both IDs and
the baseline revision used for generation; changing one requires review of
affected shots. Before render, validation must flag contradictory shot
lighting. Matching names or a shared word such as “黄昏” cannot by itself
establish continuity; the user confirms the join when the script does not
provide an unambiguous place or continuous interval.

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

### Identity resolution before ID assignment

Extraction wording is not an asset identity decision. Two descriptions such as
“街角的粮店” and “街边的粮店” may describe the same physical shop, but the
extractor cannot establish that from wording alone. Extracted mentions need
temporary candidate IDs. Before assigning formal asset IDs, resolution first
groups mentions that are established as one semantic entity, then compares
each group with current assets:

| Resolution decision | Meaning | Allowed effect |
| --- | --- | --- |
| `same_as_candidate` | Two extracted mentions are confirmed to describe one entity | Keep one candidate group; assign at most one formal asset ID to the group |
| `same_as_existing` | A candidate group is confirmed as an existing semantic asset | Reuse its `asset_id`; create a new asset revision for changed description/material decisions |
| `new_entity` | A candidate group is confirmed distinct from current assets | Allocate one new `asset_id` for the group |
| `needs_review` | More than one identity interpretation remains plausible | Do not allocate or rewrite a formal asset ID; ask for one review of the ambiguous candidate group |

Name similarity, shared words, scene order, or a model's confidence score alone
cannot move `needs_review` to either final state. The identity resolver may use
structured evidence such as an explicit return to the same landmark, a stable
script reference, or an existing asset chosen by the user. A confirmed
`place_continuity_id` can narrow the review but does not alone prove two
visual Scene assets are identical. A confirmed shooting plan is never
rewritten during this step.

This makes the lifecycle explicit: extraction proposes language, identity
resolution decides semantic continuity, asset application persists the decision,
and plan sync only projects the resulting live asset IDs. “Re-extraction creates
a new asset ID” is therefore not a valid general rule; it is only the result of
an explicit `new_entity` decision.

This is a target contract, not current runtime behavior. The current parser
allocates new UUIDs while creating each extracted Scene and Prop, and applying
an edited preview creates them again. It has no candidate grouping or reviewed
identity-resolution step.

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
  The former sync substitution and dual-ID lookup are fixed, but previously
  persisted mistaken bindings need review after sync. Add typed names at
  API/view boundaries before any persistent migration.
- Plan node stability across revisions is a target rule. The validator proves
  uniqueness within a plan only; a restore/regeneration may need reviewed
  old-to-new node mapping before references can follow it.
- Asset revisions, confirmed variant membership, and new shot/task pins are
  implemented. Explicit placement IDs, a separate candidate material flow,
  and complete `media_id` coverage remain target contracts. Do not label a
  legacy selected variant or an old unpinned package "confirmed".
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
- Audit legacy plan `shot.character_ids` values, variant `media_id` coverage, and accepted
  shot/task lineage before migrating fields or promising exact revision pins.
