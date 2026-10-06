# Asset Scope, Cover, Validity, and Uniqueness V1

Status: proposed product and identity contract; no runtime cutover.
Date: 2026-10-06

This document refines `2026-10-06-asset-revision-material-confirmation-v1.md`
and `2026-09-24-asset-material-workspace-index-v1.md`. Where the September
cover-selection implementation differs, the migration rules below apply.

## Observed

- Code fact: `Character`, `Scene`, and `Prop` records live in project, series,
  and owner-filtered global containers. The global library is a personal
  reusable pool, not a public pool shared across all users.
- Code fact: `GET /asset-index` lists assets from those containers with source
  scope. The project reference index overlays episode, series, then global
  records by asset ID within each type. The list is a read projection, not a
  fourth asset store or proof of project membership.
- Code fact: importing a global asset into a project/series, or promoting a
  project/series asset to global, deep-copies it and assigns a new asset ID.
  Child variant IDs are currently copied unchanged.
- Code fact: `ImageVariant` has an ID and URL but no unified `media_id`.
  Character variants can occupy several legacy containers. An explicit
  `cover_variant_id` can differ from a container's selected image ID.
- Code fact: the Asset Library card prefers its explicit cover, then a
  selected image, then a first variant or legacy URL. The project Assets card
  also uses cover/selection fallbacks. A fallback is a display behavior, not
  proof that its image is confirmed or available.
- Code fact: the project cover mutation checks that the variant ID belongs
  to the addressed asset. The existing model does not have a committed asset
  revision or an atomic cross-container uniqueness constraint.
- Code fact: Playground `save-to-library` copies the output to a material
  folder and marks `saved_to_library`; it does not create Character, Scene, or
  Prop. Its separate `Import as asset` flow opens the new-library-asset dialog.
- Code fact: project Assets quick-create writes a character from name and
  description; image generation is a separate call. Series quick-create may
  accept one uploaded initial image. The workbench has separate image pools
  and selections for master/full-body, three-view, and headshot, plus motion
  video variants and older `video_assets` records.
- Code fact: entity extraction preview and refinement return proposed
  Character/Scene/Prop records without changing project assets. Applying a
  reparse writes a new Script with its extracted entity lists, replacing the
  project's prior lists. This path does not reconcile old asset IDs, variants,
  or covers before replacement.

## Direct Implication

An asset's storage scope, its appearance in an Assets view, and its use by a
project are separate facts. A card image is a presentation result, while a
generation reference must identify an authorized, available material and an
exact asset variant when it refers to an asset.

## Canonical Terms

| Term | Definition | Identity |
| --- | --- | --- |
| Material | One retained image, video, or audio file and its provenance; it can exist without a semantic asset. Replacing bytes creates new material. | `media_id` in the target model; URL is only a locator. |
| Asset | One semantic character, scene, or prop, independent of its images, name, and storage scope. | Stable `(asset_type, asset_id)`; owner and workspace are authorization and placement facts. |
| Asset variant | A confirmed binding from one asset to one material, with role and provenance. Multiple assets may bind the same material independently. | `(asset_type, asset_id, variant_id)`; the binding ID is never reused. |
| Video variant | A confirmed binding from an asset to video material, for a named motion/performance role. A video task/result remains separate until confirmed. | The same asset-scoped variant identity rule, with `media_type=video`. |
| Asset revision | One committed snapshot of the asset's semantic fields, source binding, variant membership, roles, and current selections. | `(asset_type, asset_id, revision)`, monotonically increasing. |
| Placement | Membership of an asset in a personal, series, or project workspace. | Stable `placement_id` in the target model; one active placement per asset per workspace. |
| Global asset | A semantic asset placed in the owner's personal reusable library. `global` describes reach within that owner's workspace, not public visibility. | The same asset identity rules as any other scope. |
| Series asset | A semantic asset placed in a series and available to its episodes under the series policy. | Asset ID plus series placement. |
| Project asset | An asset owned by a project, or an explicit project binding to a source asset. Its source kind must remain visible. A picker candidate is not project membership. | Project placement or binding ID, plus source asset identity. |
| Assets | A user-facing view/index over authorized assets. Asset Library, series Assets, and project/episode Assets are projections, not independent owners or duplicate assets. | No separate semantic asset ID. Each row carries source identity. |
| Asset cover | The one confirmed current image used to represent an asset in ordinary cards for a committed revision. | Derived from that revision's `display` selection; no separate media identity. |
| Assets cover | The image shown for an asset row/card in an Assets view. It projects that row's source asset cover at a declared revision. | No independent selection or identity in the view. |

An **asset envelope** is the semantic asset record and its owned state:
identity, owner/placement, name and description, lineage, revision, variant
bindings, role selections, and status. The envelope may contain zero image
variants and zero video variants. A material file is not required to create
or retain the envelope. `Assets` may list such an asset with an explicit
`no_visual_material` state; image/video generation requiring a source must
still reject it until a suitable input exists.

An extraction result has two stages. Before apply, it is an **entity
proposal**, not a committed asset. After user apply, each accepted
Character/Scene/Prop becomes a project-scoped semantic asset envelope, even
when it has no visual material. Its extraction and source revisions are
provenance, not image variants. The current replace-all reparse implementation
does not yet preserve asset revision history or reconcile identities.

### Re-extraction and History

`source_revision` versions the original text. It increments only when that
text changes. An **extraction revision** versions one accepted entity snapshot
and pins its source revision, extraction configuration, and reviewed result.
Applying a changed extraction advances the extraction revision even when the
source text is unchanged. A byte-identical accepted result should be
idempotent; rerunning a preview without applying it changes no revision.

For each matched semantic asset whose definition, source binding, status, or
confirmed visual selection changes, commit `asset_revision = previous + 1`.
The new revision is the current version. The previous revision is immutable
history for comparison, rollback, and exact references held by accepted shots
or tasks. It is not another active asset and does not supply an implicit
fallback cover or generation reference to the new revision.

Reparse reconciles the new accepted snapshot with the previous one:

- A matched entity keeps its asset ID. Its new revision contains the newly
  extracted semantic facts. Prior confirmed image/video bindings remain
  attached to their old revisions. The new revision may explicitly carry
  forward a binding only after its compatibility with the new definition is
  confirmed; until then it has no current visual selection for that role and
  reports `needs_visual_review`. The old cover remains visible in history,
  not as the new revision's effective cover.
- A new entity creates a new asset ID and first revision, possibly without
  media. An entity absent from the new snapshot gets a new retired revision
  and leaves the current project Assets view; old versions and references
  remain readable.
- Matching uses typed source evidence and reviewed continuity decisions.
  Name equality alone is not identity. Ambiguous matches require explicit
  resolution before confirmed media can carry forward.

Rollback selects an old revision's content as the source of a **new** revision
with a new number. It does not decrement the revision counter or rewrite the
historical record. A rollback of one asset does not silently roll back source
text, other entities, Director decisions, or already accepted tasks. The UI
must show these dependency differences before confirming the rollback.

A style, art-direction, or model-setting change is not by itself an entity
reparse. It versions the changed configuration and marks dependent visual
outputs for review. If an actual re-extraction is requested, its accepted
result follows the revision rules above, even when triggered from a style
workflow.

`selected_variant_id` in today's generation container is not necessarily the
asset cover. In the target model, selections are named by role: `display`,
`identity_master`, `full_body`, `portrait`, `look`, and so on. Exactly one
active variant can be current for each role. The `display` selection defines
the cover; changing it need not change another role's selection. The old
`cover_variant_id` is a legacy representation of `display`, not a second
long-term authority.

Video has its own current selections, for example `motion_full_body` and
`motion_headshot`. A selected video does not become the still-image cover.
If video cards later need a poster, the poster is a derived display material
linked to that video or an explicit image variant; its identity and lifecycle
are recorded separately. A frame extracted for preview is not automatically
accepted as the character's identity/master image.

## Four Asset Creation Paths

| Entry | Target persisted effect | Initial cover | Current gap |
| --- | --- | --- | --- |
| Agent `Save as asset` from one image | Explicitly create one semantic asset in the chosen owner workspace and one confirmed image binding with source task/output lineage. The actor must choose asset type and name; repeated submission uses one idempotency key. | That one image is `display` and may also be current for its declared image role. | The observed Playground `Save to library` only retains material. It must keep the distinct `Save material` meaning; the semantic-asset action needs its own contract. |
| Asset Library `New asset` with one image | Create a personal/global semantic asset, one initial confirmed image binding, and its first asset revision in one commit. Upload and existing-material selection are equivalent after ownership checks. | The initial image is the only `display` selection. | Current API accepts an optional URL and creates a variant immediately; it has no unified media identity or committed revision. Metadata-only creation needs an explicit empty-asset state, not a synthetic cover. |
| Series/episode/project Assets `Add character` from text | Create a character identity in that chosen scope. Generation produces an output material candidate; user confirmation attaches it as an image variant. A failed generation leaves the named character with no cover and a terminal task result. | None until a generated image is confirmed. The first confirmed image can become `display` in the same explicit confirmation. | Project quick-create and generation are already separate calls, but successful generation currently attaches/selects a variant without acceptance. Series quick-create can also start with one uploaded image. |
| Character workbench | Reuse the existing character ID. Uploads, generated images, and videos are candidate materials; confirmation assigns image/video roles and commits variant membership. Changing role-current selection or `display` commits a new asset revision. | Only the current confirmed `display` image; reference selection and video selection do not change it implicitly. | Current panels have several image containers, automatic selection, a separate cover pointer, video pools, and prompt-local reference choices without one shared revision owner. |

Entity extraction is another entry into the third row's semantic-asset
creation rule: preview proposes text-backed assets; apply commits them to the
episode/project scope. It does not need to generate media to make them valid
semantic assets.

`Save material` and `Save as asset` must be separate commands. If the user
chooses the latter directly from an Agent result, the operation may retain
the material and create the asset together, but it creates exactly one asset
and one initial image binding. It must not create a second asset when the
same command is retried. A later deliberate `Save as new asset` may create a
different semantic asset using the same material.

For text-to-asset, the semantic character is valid before an image exists.
Its status says `awaiting_image` or equivalent; it must not borrow a cover
from a same-named global asset. Generating several images yields several
candidates, not several characters. Confirming two candidates creates two
bindings on the same character; one explicitly selected image is the cover.

### Character Workbench Selection Rules

The three visible regions have separate meanings:

1. **Prompt `@` references:** request-local input choices. Any authorized
   character, scene, or prop may supply an image reference when it has an
   accessible image variant supported by the selected generation mode. Choose
   the exact variant, not merely the asset name or its card cover. Referencing
   another asset does not attach its material to this character, change either
   asset's current selection, or create a revision. An asset with no image has
   no image candidate. The current `@` index exposes image variants only;
   video/audio references require their own capability and input contract.
2. **Strip between the main display and Prompt:** in static mode this lists
   image variants in that character's current role container (master,
   three-view, or headshot). These are asset-bound image variants in today's
   implementation, not material revisions and not voice assets. Selecting one
   sets the current image for that panel's role. In the target model, a
   candidate material is shown separately until confirmed as an asset variant.
3. **Main display:** a viewer for the current image variant of the active
   panel's role, or an explicit empty/unavailable state. It is not inherently
   the character's `display` cover. The asset card cover follows its own
   `display` selection; the main viewer and cover may show different images
   because they answer different questions. Zooming or locally previewing a
   strip item changes neither selection nor revision.

In motion mode the panel instead displays a motion/video result and an
optional uploaded audio input used to drive lip-sync or rhythm. That audio
input is a task input, not a version of the character's voice identity.
Current code displays the latest video in the array rather than its stored
`selected_video_id`, and the upload is held as a local URL; therefore the
current player cannot be treated as an authoritative video-variant selection.
The target contract displays the current confirmed video for the named motion
role and records the exact video and audio material IDs used by a task.

| Choice in the workbench | Changes asset? | Meaning |
| --- | --- | --- |
| Check image/video candidate, then confirm | Yes, one asset revision | Accept material into this character with media type and role. |
| Choose current master/full-body/three-view/portrait image | Yes, one asset revision | Set current variant for that named image role only. |
| Choose asset cover | Yes, one asset revision | Set the current `display` image from this character's active image bindings. |
| Choose current motion video | Yes, one asset revision | Set current video for its motion role only; image cover stays unchanged. |
| Pick a reference in the prompt or `@` selector | No | Bind an exact permitted image/video input to this draft/task only. |
| Highlight a thumbnail for inspection | No | Local view state; neither cover nor generation input changes. |
| Generate image/video | No asset revision until confirmation | Produce task output material and lineage; a failed result leaves active variants intact. |

An image can be eligible for several roles without cloning its bytes.
Role-current selection is unique within the asset revision, while the same
image may be both `display` and `identity_master`. Video candidates must carry
their input image/material reference and task lineage. The current code's
`source_image_id=None` on a motion video is a provenance gap, not evidence
that the video had no source image.

## Scope and Copy Rules

1. A personal/global asset remains personal even when a project picker shows
   it. Direct project use requires an explicit binding or placement; a
   generation reference alone creates neither.
2. A project binding pins the source asset revision and chosen variant IDs.
   Source edits do not silently change an accepted shot or project binding.
   Refreshing the binding is an explicit action. This is the target contract;
   today's global fallback is live and does not provide this guarantee.
3. A fork creates a new semantic asset ID and new variant binding IDs, records
   `forked_from` source asset/revision/binding IDs, and may retain the same
   `media_id` when the material remains authorized and retained. It does not
   imply another copy of the image bytes.
4. Moving a placement without forking preserves the asset ID. The operation
   must be explicit and must preserve ownership and reverse references.
5. A series asset inherited by an episode remains series-owned. An episode
   override or fork gets its own identity; name equality is irrelevant.

## Validity

These predicates are distinct and must not be collapsed into one `valid`
boolean:

| Predicate | Required condition |
| --- | --- |
| Identity valid | Owner and scope resolve; asset type/ID exist exactly once in the authoritative owner; revision exists; IDs are not inferred from names or URLs. |
| Binding valid | Image or video variant belongs to that asset and revision, references material of the declared media type, has an allowed role, and is active rather than archived. |
| Cover valid | Exactly one active `display` selection resolves to a retained image variant in the same asset revision. It cannot point to a candidate, another asset, an archived binding, or missing media. |
| Displayable now | The cover's material can currently produce a preview. A temporary delivery or signing failure leaves the binding intact but renders an unavailable state. |
| Generation-reference valid | The actor is authorized; exact material/variant is accessible and supported by the chosen task/model; the accepted task freezes its IDs and revision. A thumbnail or signed URL cannot satisfy this check. |

For video, validity also requires a playable/decodable source for viewing and
model-specific permission before it can be a generation reference. A valid
video binding is not proof that its source image, audio, or model output is
still available; those dependencies are checked for the intended operation.

An asset may be valid and intentionally have no cover. In that state Assets
shows an explicit empty/unavailable image state, not a random candidate or the
first array element. A missing cover preview does not select another variant.
An invalid cover pointer is surfaced as a repair state; it is not silently
persisted as a different cover. Legacy display fallbacks remain read-compatible
until each affected asset is reconciled.

## Uniqueness and Resolution

- One canonical asset ID identifies one semantic asset across the owner's
  workspaces. The target metadata owner rejects duplicate canonical IDs,
  including duplicates of different asset types if IDs are used without type
  elsewhere. Legacy collisions are resolved using `(owner, source scope,
  container ID, asset type, asset ID)`; the project index's precedence is a
  compatibility display rule, never an identity rule.
- One active placement of an asset exists per workspace. A source asset and a
  project fork are two different assets and must carry lineage, not masquerade
  as the same asset in different scopes.
- One `variant_id` identifies one binding. A fork cannot reuse the source
  binding ID even when both bindings point to the same `media_id`. Within one
  asset, a material/role pair has at most one active binding unless a named
  use case requires separate bindings with distinguishable provenance.
- An asset revision has at most one current selection per role, including
  exactly zero or one `display` cover. No two competing cover fields are
  authoritative for the same revision.
- An Assets index row is keyed by source workspace/placement or binding plus
  asset identity, not by name, URL, or array position. A project effective
  view shows one row per effective asset while retaining source identity and
  reporting collisions; it must not silently treat a hidden same-ID asset as
  the selected source.
- The same material may appear in several assets and variants. Physical media
  deduplication does not merge semantic assets or their revision histories.

## Legacy Cover Migration

1. Inventory each asset's explicit `cover_variant_id`, container selected
   IDs, variant IDs/URLs, source scope, and owner. Detect copied child IDs and
   same-ID assets hidden by effective-index precedence.
2. Preserve every existing pointer and image. Mark existing attached variants
   `legacy_attached`; do not infer user confirmation from their presence.
3. Where an explicit cover resolves to an attached, accessible image, present
   it as the legacy display choice. If cover and selected image differ, keep
   both role choices; do not silently overwrite either. A missing or ambiguous
   pointer requires a visible repair decision.
4. Once confirmed, commit one revision containing active bindings and role
   selections. Both Asset Library and project/episode Assets then project its
   `display` cover. Historical accepted tasks keep their prior exact inputs.
5. Only after reconciliation and parity checks may old cover fields and
   first-variant fallbacks stop acting as compatibility reads.

## Not Yet Proven

- No production-wide inventory yet establishes how often asset IDs or copied
  variant IDs collide, or how often explicit covers differ from selections.
- No unified media registry, placement table, atomic asset revision store, or
  pinned project binding currently enforces the target uniqueness rules.
- Agent `Save as asset` and an atomic material-plus-asset create operation are
  target behavior, not capabilities established by the observed
  `save-to-library` endpoint.
- Current preview resolution checks a local path or storage locator at read
  time. A stored URL and a successful index response do not prove continued
  media availability or permission at task submission.

## What Would Verify It

1. A read-only inventory reports owner/scope/asset/variant collisions,
   explicit-cover disagreements, missing media, and effective-index shadowing.
2. A metadata implementation rejects duplicate identities and stale revision
   writes; tests cover fork lineage, shared material retention, and one current
   selection per role.
3. End-to-end checks compare the same asset in Asset Library and project
   Assets, then change its cover, archive a variant, and verify that accepted
   shots/tasks keep their pinned references.

This is a definition and migration contract. It does not claim that the
current JSON stores, indexes, or UI already enforce these rules.
