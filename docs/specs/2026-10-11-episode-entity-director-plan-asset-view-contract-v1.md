# Episode Entity, Director, Plan, Asset View, and Storyboard Contract v1

Date: 2026-10-11
Status: target design; the view identities, extraction reconciliation, and
shot-level validation described here are not implemented.

## Observed

- Re-extraction currently allocates fresh Scene and Prop IDs and applies a new
  `Script` entity collection. The confirmed plan retains its historical asset
  references; sync projects those references and reports unresolved demands.
- Director understanding has narrative `person_id`, phases/events, and proposed
  episode continuity, but no persisted, reviewed scene-by-scene character view
  registry. A plan cast binding carries `person_id`, optional `era_variant_id`
  and `scene_look_id`, plus untyped `continuity_state`.
- The projected visual context groups cast by person, plan scene, era, look,
  and serialized state. A projected shot still supplies Character asset IDs.
  `StoryboardFrame.character_ids` and its image-variant choices are keyed by
  Character asset ID; `shot_size`, blocking, and acting are separate fields.
- Asset revisions and shot reference-package pins can retain exact variants
  and media. This does not yet pin a reviewed scene character view or prove that
  a selected variant depicts the required clothing, prop, or injury state.

## Direct Implication

A Character asset ID alone answers **who** the person is. It does not answer
which appearance or physical state the character has in a scene, nor how that
character is positioned and photographed in one shot. A close shot and a long
shot of the same action should not create two live Character assets.

## Identity Layers

| Layer | Target identity and owner | Carries | Does not carry |
| --- | --- | --- | --- |
| Narrative person | Episode `person_id`, with reviewed series mapping when available | Story identity, aliases, event participation | Image selection |
| Semantic Character | One current live `character_asset_id` per narrative person in an episode, resolved by explicit mapping | Stable appearance identity and asset revisions | Scene-specific clothing, camera distance |
| Episode look | `character_look_id`, owned by episode and parent Character asset | Reusable attire, hair, injury, equipment worn/carried and continuity interval | A particular shot pose or crop |
| Scene character view | `character_view_id`, owned by `(episode_id, confirmed_plan_scene_id, person_id, appearance_segment_id)` | Chosen look, state on entry/exit, held Prop asset IDs, starting blocking, source/evidence, review status | A new person or Character asset |
| Shot cast use | `(plan_shot_id, person_id)` linked to one scene view | Position, pose, action, gaze, held-prop transition, prominence, shot size/visibility | A second live Character asset |
| Selected media | Asset/scene-view variant binding and shot reference-package pin | Exact asset revision, variant/media ID, intended role and framing suitability | Semantic identity inferred from pixels |

`character_look_id` and `character_view_id` are new target IDs, not aliases for
the existing free-text `scene_look_id`. A scene view is an episode production
record, not a new Character asset in the library. A look can be reused across
several scene views only when the state is confirmed continuous. The same plan
scene and person normally have one appearance segment; if the person exits and returns with a
changed look or state within that scene, split the appearance into explicitly
ordered segments and give each segment its own view ID. All links use typed IDs;
similar labels and ID string equality never establish a mapping.

Existing `era_variant_id` may refer to a distinct Character asset. The target
one-live-asset rule requires an explicit migration decision: keep the reviewed
person's current Character asset as the base, represent era/scene changes as
looks and media variants when semantic identity is unchanged, and retain old
asset IDs only as historical lineage/material sources. Do not merge different
people or rewrite confirmed plan, asset revision, or shot history to satisfy
this rule. Until migrated, the legacy mapping remains visible and unresolved
where it conflicts with the target invariant.

For places, `plan_scene_id` names the production scene; `scene_asset_id` names
the reusable environment; `place_continuity_id` joins physical place and
`time_continuity_id` joins continuous story time. A target `scene_view_id`
belongs to one plan scene and Scene asset and records visible environment
state, dressing, weather, and the reviewed place/time lighting baseline. Two
views of the same street may use one Scene asset with different framing; two
distinct Scene assets may share a place continuity ID. No such ID alone
proves that two Scene assets or two rendered backgrounds are identical.

## Stage Contract

| Stage | Input and decision | Output | Gate before downstream use |
| --- | --- | --- | --- |
| Entity extraction | Source revision; group mentions within the new extraction, then compare each candidate with current live entities. Mark `same_as_existing`, `new_entity`, or `needs_review`. | Current person/Character, Scene, and Prop identities plus candidate-to-current decisions. Same entity keeps ID and advances revision; only a distinct entity gets a new ID. | Ambiguous identity cannot be silently assigned by name. Applying extraction does not rewrite confirmed plans. |
| Director understanding | Source-backed entities and ordered events; read adopted series state as versioned context. | Reviewed scene/event/time line, person entry/exit state, place/time continuity proposals, object handoffs, and unresolved contradictions. | Each continuity claim cites source/event or is marked interpretation. Missing interval or identity evidence stays unresolved. |
| Shooting plan | Adopted Director revision and current entity mappings. | Versioned plan scenes, beats, shots, place/time baselines, scene character views, scene views, and shot cast uses. | Confirmed plan pins its source/Director revision; view state transitions and light overrides are reviewed. No plan node ID is treated as an asset ID. |
| Episode Assets | Confirmed plan plus live asset revisions and prior episode choices. | One live semantic asset per confirmed entity, episode look/view requirements, candidate or approved view variants, media lineage, and typed unresolved demands. | Sync only projects and checks; media generation and asset selection are separate actions. A view is not marked ready because its parent asset has a cover image. |
| Storyboard and Shot Design | Confirmed shot, resolved view IDs, and eligible media. | Frame references to semantic asset, scene/character view, shot cast use, and exact asset revision/variant/media pins. | Refuse or flag missing/mismatched view state before confirmation/render; preserve earlier pins when defaults or live revisions change. |

The Director layer decides narrative continuity; the plan commits production
interpretation and blocking; Assets supplies reviewed visual material; the
storyboard chooses exact per-shot references. A later stage may propose a
correction, but changing a confirmed upstream decision requires a new reviewed
revision. Sync must not create entities or regenerate/overwrite visual media.

## View and Variant Lifecycle

1. A confirmed plan scene creates a **requirement** for each present person's
   scene view. Reuse an episode look when its clothing, hair, injury, and
   carried equipment match the incoming continuity state. Otherwise propose a
   new look under the same Character asset. Entry position and posture live in
   the scene view; the individual shot may move the person or change pose.
2. The Assets screen groups by the unique live Character or Scene asset. Inside
   that asset, show episode looks, scene views, the scenes/shots requiring each,
   state fields, candidate imagery, approved imagery, and missing material.
   Historical assets and their media appear as reusable source material with
   lineage, never as competing live descriptions. An old image may be attached
   to the live asset/view only after explicit review and a new revision/binding.
3. Character view imagery can have full-body, face/close, three-quarter, and
   distant silhouette/reference roles. These are media variants of one look,
   not new Character IDs. A held sword is a separate Prop asset reference plus
   a state/interaction in the view or shot. It may appear in a composite
   reference image without becoming part of the Character identity.
4. Scene view imagery can have establishing, storefront, interior, or camera
   angle roles under the chosen Scene asset. A particular first/last frame or
   fight composition remains shot-scoped. Promoting it to a reusable view
   variant is explicit and retains its source shot/media lineage.
5. Changing look state invalidates dependent scene views and shot selections
   for review. Changing entry blocking invalidates affected shots, not the
   Character identity. Changing a shot pose or crop invalidates only that
   shot's reference package. Changing an asset default never changes a
   confirmed shot pin. Retired views remain readable in historical revisions.

Selection order for a shot is: explicit shot reference pin; reviewed scene
view variant with a suitable role; reviewed episode look variant; approved
Character base variant. A fallback is labeled incomplete when it cannot
demonstrate the required state or framing, and must not be silently presented
as an accepted match. There is no automatic image-content proof: review or a
future validated classifier is required for visual suitability.

## Example: Grain Shop Fight

The adopted Director map identifies Su Yan and Jiang Zhuo as two people in
one continuous dusk interval at the grain shop. Identity review maps each to
one live Character asset. The plan scene has one Scene asset and a reviewed
place/time lighting baseline.

| Shot | Scene view and cast use | Asset/reference choice |
| --- | --- | --- |
| Su Yan arrives at the shop, sword in hand, close shot | Su Yan's scene view specifies current clothing, sword Prop ID, entry position and held state. This shot specifies hand/face pose and close framing. | Same Su Yan Character asset; choose a matching close reference variant and sword reference, then pin exact revisions/media. |
| A scout watches Su Yan and Jiang Zhuo fight from afar | Reuse their scene views while continuity state is unchanged. Both shot cast uses specify distant scale, fight positions and actions; the scout gets a separate cast use. | Same two Character asset IDs; select distant/full-body references where suitable. The combined fight image belongs to this storyboard shot. |

If Su Yan drops the sword between these shots, the shot records the transition
and subsequent scene/shot state must no longer claim it is held. A new look is
needed only if the change persists as a reusable visual state; no new Character
ID is created. The common place/time baseline is inherited unless the plan
records an explicit lighting override and reason.

## Proposed Persistence and Validation Slice

- Persist reviewed `EpisodeCharacterLook`, `SceneCharacterView`, and
  `EpisodeSceneView` records under the episode, with parent IDs, source and
  plan revision, state, review status, and eligible variant bindings. Add typed
  `character_view_id`/`scene_view_id` links to projected shot context and
  `StoryboardFrame`; keep legacy asset ID fields for compatibility.
- At extraction application, reconcile candidate groups and old live entities
  before assigning formal IDs. Save the decision and source evidence. A
  `needs_review` candidate cannot replace a live asset. Retired material keeps
  owner, source asset/revision, and media ID; old IDs never become revisions of
  a different ID.
- At plan confirmation, validate per-person view uniqueness/segments, entry to
  exit state transitions, Prop IDs, plan-scene membership, place/time baseline
  and explicit lighting overrides. At Assets sync, require current parent
  assets and report missing view/media separately. At frame confirmation and
  render submission, validate the resolved view, suitable variant role,
  revision/media pin, shot state, and light lineage.
- Existing plans and frames continue to load. Their `scene_look_id` and
  `continuity_state` become migration candidates, not automatically confirmed
  view records. Current asset-only storyboard pins remain valid historical
  facts but are labeled `view_unverified` until a scene view is reviewed.

## Not Yet Proven / What Would Verify It

- No current runtime proves one Character asset per person, identity continuity
  across re-extraction, view readiness, or visual match of a chosen image.
- Verify with a fixture containing two names for one shop, two plan views of
  the same dusk, a clothing change, the close/distant fight shots above, and a
  re-extraction. Assert stable live IDs after `same_as_existing`, new IDs only
  for `new_entity`, explicit unresolved cases, no plan-history rewrite, and
  correctly scoped invalidation and shot pins.
- Test legacy plans with multiple era Character IDs and frames with only
  asset IDs. Migration must preserve history and surface review demands.

Related contracts: `2026-10-10-script-plan-asset-material-identity-v1.md`,
`2026-10-11-plan-continuity-and-entity-reextraction-v1.md`, and
`2026-10-09-series-episode-director-understanding-structure-v1.md`.
