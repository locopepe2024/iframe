# Asset spatial continuity contract v2

Status: design proposal. This document does not claim a deployed editor, Director integration, or visual consistency of generated images.

## Observed

- `asset_spatial.py` validates scene buildings, anchors and apertures; character height, width and reach; prop dimensions and one grip point. Confirmed designs store these values in numbered design revisions.
- The frontend has matching TypeScript types, but no asset design editor currently reads or writes those types. Their presence does not establish that creators have supplied metric facts.
- `ShotSpatialConstraints` can pin a confirmed scene layout revision and store selected asset placements, cameras and required sightlines. The current shot update path checks scene revision, selected asset IDs and anchor IDs. It does not validate character/prop revision pins, actual occlusion, motion, or whether a camera satisfies a sightline.
- The offline Qingxi street GLB trial used hypothetical dimensions. Its rendering and raycasts establish only that this particular blockout can be viewed from selected cameras. They do not establish the actual street layout.

## Ownership and flow

```text
confirmed scene/character/prop design revisions
  -> immutable metric facts with evidence and uncertainty
  -> Director 3D reads pinned revisions and designs spatial + temporal shot candidates
  -> creator reviews one candidate
  -> storyboard receives a pinned shot plan and generation references
```

Asset design owns reusable facts independent of any shot. Director 3D owns stage placement, camera, lens, blocking, pose, movement and shot-relative time. Storyboard owns the selected shot plan and its generation submission snapshot. No Director proposal may silently rewrite an asset's confirmed revision. A changed asset revision makes a candidate stale until it is reviewed again; historical shot plans keep their original pins.

## Shared metric conventions

- Units are meters; world and asset-local coordinates are right-handed, `z_up`. `+x` is right and `+y` is forward in each asset's neutral orientation. Every transform records translation and yaw, with scale fixed at 1 for confirmed asset facts. A mirrored asset is a distinct variant, not a negative scale.
- A scene layout defines one world frame and a stable `layoutId`. Its origin and `+y` direction are explicitly named in the confirmed design. An asset's local origin is the foot contact center for a character, the support contact/pivot for a prop, and the layout origin for a scene. Camera coordinates belong only to Director/shot data.
- An estimate from one image is `estimated`, with source image identity, method and an interval or stated tolerance. A user-measured or manually confirmed value is `confirmed`. Unknown values remain absent. Confirmation means approval of the design value, not proof that generated pixels obey it.
- IDs for anchors, zones, openings and attachment points are stable within a layout revision. Cross-revision reuse of an ID means the same semantic point; moving or removing it requires a new revision and invalidates unreviewed dependent candidates. Consumers pin asset ID, design revision and a canonical content checksum.

## Scene facts

The scene revision should contain:

1. Layout frame and metric ground/level heights. Walkable zones have bounded footprints and elevation; fixed structures have footprint, height, orientation and semantic identity. This supplements the current axis-aligned `buildings` boxes without treating a box as a finished 3D model.
2. Stable anchors at meaningful places: entrances, shop counter, loft lookout window, road junction, stairs and other reusable positions. An anchor records position, facing direction, parent structure/zone and purpose. Image-only features without established depth remain unresolved.
3. Openings/portals with dimensions, normal and connected zones. A doorway or window is an opening, not merely an unqualified point on a wall. Connections state where movement is physically possible; windows may support visibility without permitting passage.
4. Explicit spatial relations that must be preserved, such as shop-to-loft relative side and approximate distance, and any reviewed two-way visibility requirement. Visibility is a design requirement to be checked against the Director geometry and camera, not a stored assertion that a rendered frame passes.
5. Fixed collision/occlusion proxy bounds with provenance. Movable props, temporary crowds, camera framing, time of day and one-shot action are excluded. Lighting remains a separate scene visual baseline with explicit shot overrides.

For Qingxi street, the grain shop and loft should be distinct structures in one layout. Each gets named door/window anchors and a reviewed relative-position constraint. The two directions, shop looking toward loft and loft looking toward shop, are separate camera tests. A street-level sightline does not prove the reverse elevated view.

## Character facts

The confirmed character revision should keep height, shoulder/body width, approximate depth, eye height, shoulder/hip/hand/foot landmark heights, neutral foot contact, and a conservative reach envelope. These are identity and proportion constraints in a neutral stance; they do not specify a shot pose. The character's face and clothing design remain owned by existing visual design/asset-pack revisions. A metric proxy may reference the approved visual revision but must not claim face-lock or output likeness solely from dimensions.

Body landmarks carry stable IDs and local positions; proportions must be internally valid (for example eye height below total height, feet at ground and reach positive). Different ages or body designs require explicit revisions/variants. A temporary crouch, turn, expression or hand gesture belongs to the Director timeline, not this asset record.

## Prop facts

The confirmed prop revision should keep length/width/height, local origin, canonical forward/up axes, support/contact points, and named interaction anchors such as handle, trigger, blade guard or lid. Each interaction anchor records a local transform and permitted use (`grip`, `support`, `attach`, `look_at`), plus optional hand compatibility. Multiple grips are allowed; one `gripLocalM` cannot describe a two-handed object. Movable placement and hand-to-prop binding at a specific time belong to Director, while the prop's physical anchor locations remain reusable asset facts.

## Director and storyboard handoff

- Director consumes one immutable set of scene, character and prop revision pins. Missing metric facts are marked unresolved; Director may draft geometry with labeled assumptions, but cannot publish those assumptions as confirmed asset data.
- Director's shot candidate records placements and yaw in scene world coordinates, camera/lens with target or orientation, required visibility checks, action/attachment events on a shot-relative seconds timeline, and a validation report. Every event refers to stable asset/anchor IDs and a pinned revision. Frame rate is an export setting, not the timeline's source of truth.
- Validation checks reference integrity, finite metric values, zone/level fit, collision and walkability of static placements, reach/contact during interactions, camera frustum, and raycast occlusion for required sightlines. A pass is a proxy-geometry result; ambiguous image geometry stays labeled unresolved. The user can review exceptions without turning them into false measured facts.
- On acceptance, storyboard stores the selected candidate ID/version, asset pins, validated spatial/temporal plan checksum and the visible generation reference set. The generation submission freezes that state. Later revisions do not retroactively alter a submitted frame or result. The current `ShotSpatialConstraints` v1 is a partial container, not this complete handoff contract.

## Versioning and implementation boundary

Define `iframe.scene-spatial.v2`, `iframe.character-spatial.v2` and `iframe.prop-spatial.v2` as additive, explicit contracts. Keep v1 data readable. Do not silently promote a v1 box or an image estimate to v2 confirmed geometry. A migration may copy known fields with `estimated`/`unresolved` status and ask the user to review the missing frame, orientation, zones and anchors. v2 editors should save through the existing confirmed design revision path; Director should access these records through an asset-revision read projection, not through an import of asset editor UI state.

The initial implementation slice should add strict backend/TypeScript schemas and focused invalid-input tests; then a reviewable asset editor for scene frame/anchors, character proportions and prop attachment points; then a pinned read projection for Director. Director candidate validation and storyboard acceptance follow as separate slices. No media-host or deployment change is needed to establish the asset-side contract.

## Acceptance and limits

- Saving each asset type rejects non-finite/negative dimensions, invalid local transforms, duplicate IDs and broken references; confirmed revisions retain provenance and checksum after reload.
- Reopening a design shows unknown, estimated and confirmed values distinctly. A draft estimate cannot become confirmed by merely saving an image.
- Director reads exact pinned revisions. Editing an asset leaves historical shot submissions unchanged and marks only unaccepted candidates using that revision stale.
- Shop-to-loft and loft-to-shop are tested independently with two reviewed anchors, geometry and cameras. The report distinguishes in-frame, unobstructed and unknown.
- A prop grip can be placed in a character hand and checked against the character's reach envelope over an event interval; the check does not claim physically correct animation.
- Generated image/video consistency remains unproven until multi-view output samples are compared to the pinned plan and reviewed by a person.

Affected paths for implementation: `src/apps/comic_gen/asset_spatial.py`, asset save/read projections in `pipeline.py` and `api.py`, `frontend/src/lib/assetSpatialConstraints.ts`, asset design editors, focused schema/persistence tests, then Director/Storyboard consumers in their respective modules.
