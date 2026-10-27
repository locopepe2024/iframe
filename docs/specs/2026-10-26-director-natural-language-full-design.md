# Director natural-language design expansion

## Product requirement

All five requested areas are required: poses/contact; additional characters and
real model assets; lighting/materials/clothing/appearance; timed camera motion;
complete editable scenes and generated scene imagery. The earlier static slice
is an initial implementation boundary, not the final product scope.

Default workflow: natural-language request → structured proposal → editable
preview → apply → one undo transaction. Generation jobs retain their existing
owner, cost disclosure, review and artifact provenance. The director authoring
store owns scene truth; DirectorShotPackage remains its export projection.

## Observed starting point

On GitHub main 659d264b the director has seated.sit and other pose presets,
camera paths and admitted model asset structures. A seated pose explicitly
requires further matching to the seat. These code facts do not establish
contact correctness or natural-language accessibility. This main revision lacks
src/apps/director_design.py, while earlier feature work and deployed API had it.
Reconcile deployment source and the static proposal implementation before
editing contracts; do not replace current main with the old feature tree.

## Delivery sequence and acceptance

1. Seated pair, current camera: resolve the two actors and chair assets, apply
   seated poses and seat anchors, preserve all camera fields. If no chair asset
   is available, offer an explicitly labelled proxy candidate or asset selection;
   a proxy must never be reported as a real chair. Verify pelvis/seat and foot
   support in the admitted rig, preview without mutation, atomic undo/redo,
   stale and locked-object rejection. Use the exact reported Chinese request
   as the live-model regression scenario.
2. Poses and contact: expose existing admitted pose presets and bounded joint
   edits, then add lying poses and support/contact anchors for chair, bed, floor,
   hand and prop. Resolve rig joints and transforms deterministically. Distinguish
   verified contacts from approximations; reject unsupported rigs explicitly.
   Verify evaluated geometry and visible result, not preset names alone.
3. Actors and real assets: resolve existing library/catalog IDs; import via
   existing admission pipeline; create actor mappings and instances atomically.
   Validate asset type, rig, dimensions, pivot, loading and rendering capability.
   Show missing assets and loading failures before apply. Source preference is
   pending user input; default to existing assets and configured services.
4. Lighting and appearance: add authored light entities and material bindings
   using renderer-supported fields, then outfit/appearance asset changes.
   Keep physical scene edits distinct from generated appearance images, which
   require existing generation services and review. Verify both browser and
   export support before claiming the same lighting/appearance in results.
5. Timed camera motion: compile duration, start state, displacement/path,
   target binding and easing into existing camera paths/timeline. Example:
   advance 0.5m over four seconds while keeping the target and 35mm lens.
   Candidate preview must evaluate time without changing authored playhead or
   recording state. Apply timeline/path and scene changes in a single transaction.
   Check first/last and intermediate frames, collisions, targets, undo/redo,
   frame range and video/package checksum binding. Preserve unrelated tracks.
6. Full scene and image: plan objects, actors, supports, lights and cameras as
   one validated scene proposal. Missing/generating assets remain explicit pending
   dependencies, not silently applied placeholders. Submit scene-image requests
   through the existing generation job owner with package checksum and frame/
   camera identity. A generated scene image is an image artifact; metric depth
   still comes from media Blender and must not be inferred from image styling.

These increments deliver the five required areas; steps 1 and 2 split the
contact work so the reported seated-pair case can be validated first.

## Shared contracts

Extend a versioned operation union with admitted IDs and bounded numeric fields.
No model-generated scripts or arbitrary external URLs are executable operations.
Proposal dependencies, unsupported capabilities and required clarifications must
be displayed. Do not partially apply a compound request with missing dependencies.
Revalidate revision, owner/asset admission, locks and references at apply time.
Snapshots/undo/export packages must include every new authored field. Generated
jobs are not reversible by scene undo; disclose them separately before submission.

## Verification and affected boundaries

Read and update the source spec before each implementation slice. Expected paths:
director design API/schema and tests; director design parser/compiler/panel;
workbench store; pose/contact and rig evaluation; scene asset admission; render
scene types and viewport; timeline evaluator/paths; shared package projection;
existing asset/image generation APIs. Introduce lights/contact schema only in
their owning modules and keep serialization/backward loading explicit.

Per slice run focused frontend behavior tests, backend schema/API tests and
frontend typecheck, then a real-model synthetic scenario. Add render/runtime
checks where geometry or media changes. Use media Blender, never local Blender.
Browser acceptance requires the separately scoped browser authorization from
root AGENTS.md. Code tests, live-model observations and visual/metric results
must be reported separately; do not claim broad reliability from one run.

## Completion criteria

Users can describe each of the five design areas, review a concrete result,
edit/apply/revert the authored change, and export artifacts bound to its current
package. Exact seated-pair regression works with unchanged camera. Each required
capability has code, meaningful tests, real-provider observations and appropriate
visual/render acceptance; a roadmap or schema addition alone is not completion.

## Capability inventory and first implementation contract

| Capability | Evidence / existing owner | Planned natural-language support |
| --- | --- | --- |
| Object layout / transforms | CLI-Anything core/objects.py add/transform; director authoring store | Existing placement and pair compiler |
| Pose and seating | Director pose-presets.ts has seated.sit; no contact solver in CLI-Anything inspected core | Preset operation; fitted procedural chair for canonical rig first |
| Materials | CLI-Anything core/materials.py; director materialHint on primitives | Bound material parameters, then admitted appearance assets |
| Lights and cameras | CLI-Anything core/lighting.py; director cameras / renderScene | Static cameras now; authored light entities later |
| Timed animation | CLI-Anything core/animation.py add_keyframe; director cameraPaths/evaluator | Compile timed motion into existing timeline owner |
| Real characters / furniture | Director admitted assets and actor mappings | Library selection / import / explicit dependencies |
| Full layout / generated image | Prior Holodeck research informed constraint separation; no new local runtime verification | Compose scene operations and existing image jobs |

This inventory records code presence, not integrated runtime coverage. No
Holodeck, Blender MCP or CLI-Anything runtime is installed into the product.
The inspected CLI-Anything Blender core does not itself prove natural-language
understanding, skeletal posing, contact solving or clothes generation.

## Reference output ownership and reuse

### 2026-10-27 implementation slice

Closeout before storyboard trials: add a preview-only time scrubber that never
changes the authored playhead/revision; accept nullable optional group poses
serialized by Pydantic and reject prop IDs as group actors. Export/import a
portable JSON design bundle for the current natural-language authoring subset:
canonical white models, primitive props, all cameras, pose values, actor/camera
paths, and camera-path timeline tracks. Preserve their authored fields and the
evaluated shot projection. Asset-library references are carried as stable
asset/variant/media IDs and capability metadata; unresolved actor, camera,
path, subject, object or environment references are rejected rather than
silently dropped. The portable JSON is the layout-reference payload that a
user may explicitly save through the ordinary asset-library path. It is not an
approval gate or a new asset store. Import validates the entire file before a
single undoable replacement; callers performing an async apply may pass the
package checksum they read to reject a stale import. The importer never
executes data. Verify round-trip seated pairs and timed camera paths,
malformed/referenced-missing input, stale imports, and undo/redo. Run focused
UI/backend tests, typecheck and build.

Natural-language design takes priority over asset integration. Timed linear
camera motion must retain an explicit requested distance (0.5 m over 4 seconds
is the regression case), preserve the lens and target bindings, reject moves
through the target or below ground, and retain atomic apply/undo. Distance is
optional for older proposals and preset defaults; it is not a radius or arc
length for orbit/half-arc/spiral presets. Verify first, midpoint and last frames.

Code inspection: DirectorShotPackage is an evaluated-frame export projection.
It contains one active camera and timeline track IDs, but not every authored
camera, full track/keyframe data or actor mappings. Browser local-draft export
also clears proxy/calibration/media dependencies. Neither format alone is a
lossless editable library asset. A reusable design bundle must retain authored
characters, actor mappings, objects, all cameras, full timeline, actor/camera
paths, environment and admitted dependency IDs alongside the evaluated
DirectorShotPackage and its checksum. Import must validate these dependencies
and create a new editing instance. The local JSON export/import is implemented;
saving it to the asset library remains an explicit user action through the
ordinary asset/variant/media path.

The 3D director reads scene, character, prop and crowd assets from the ordinary
asset library. The user lays them out, composes the camera, and explicitly
saves the resulting 3D layout snapshot as a normal reference asset. A
storyboard then selects the saved scene/character/prop/crowd assets plus the
layout reference; it does not send an automatic context request back to the
director. Optional blocking image, depth, camera-motion and action-motion
outputs remain attached references, while the structured layout is the
minimum reusable record.

This separates three meanings that must not be conflated:

- the director scene is the editable spatial source;
- the manually saved ordinary process asset is the reusable reference artifact;
- a storyboard shot is a read-only consumer binding.

When the user chooses Save to Asset Library, the selected director result
creates an ordinary process-asset variant with the existing asset-library
identity and media lifecycle. Optional provenance metadata may record the
source director revision, package checksum, frame, camera, purpose, media
status and source hashes. A later director correction creates another saved
variant only when the user saves it; it never rewrites a library variant
already used by a shot. Deleting or replacing the current director scene does
not silently change an existing library reference.

The four output classes remain separate in the library record. `depth` records
world-depth/occlusion purpose and submission status; `blockingImage` records
numbered layout and composition purpose; `cameraMotionVideo` records camera
path and timing; `actionMotionVideo` records body-motion and rhythm. None is
implicitly a final character, scene or prop asset, and metric depth is still
produced by the depth tool/media pipeline rather than inferred from an image.

The proposed handoff API should therefore be interpreted as:

```text
POST /director3d/reference-generation-requests
GET  /director3d/reference-generation-results/{request_id}
PATCH /director3d/reference-generation-results/{request_id}/adjust
existing project asset admission route for the selected asset type
```

The final admission is an explicit user action through the existing
asset-library path for the selected asset type (image, depth artifact or
video). It is not automatic and is not a direct storyboard write. The saved
record must be marked as a process/reference asset rather than a final
character, scene or prop asset. The response exposes the normal `asset_id`,
`variant_id` and `media_id` values that storyboard consumers bind read-only.

The identity levels are distinct:

```text
asset_id
  existing asset-library identity

variant_id
  existing saved output variant

media_id
  existing concrete PNG, depth artifact or video file identity
```

Use the existing asset revision and variant rules. A director correction must
create a new ordinary variant or revision only after the user explicitly saves
it; a `media_id` is never overwritten. No director-specific asset hierarchy is
introduced.

## Desktop reference: numbered blocking sketch workflow

The reviewed `/Users/owen/Desktop/ai多人占位.docx` describes a three-step
workflow: draw a numbered blocking sketch, translate the numbered spatial
relationships into anchored instructions, then iterate with local replacement
commands. The direct product implication is that actor identity and relative
position should be represented as explicit structured members rather than left
inside one free-form paragraph. The current implementation adds
`arrange_group` for 2–10 existing actors, explicit positions and yaw, and an
optional admitted pose preset per member. This is a code fact verified by the
compiler and tests; it does not yet prove sketch-image parsing or image-model
spatial fidelity.

The document's lying poses, arbitrary contact, negative-prompt enforcement,
scene-image generation and multi-reference image workflow remain hypotheses or
future integrations until their owning asset, pose, contact and generation
boundaries exist in the director runtime. A sketch upload should later become a
reviewable spatial-anchor artifact with numbered identities and confidence,
rather than an opaque prompt attachment.

First slice adds `set_pose(actorId,presetId)` for an explicit safe preset list and
`seat_actor(actorId,chairId)` for the currently shipped canonical white model.
Seating retains actor XY/yaw and every camera field, uses the existing seated.sit
joint rotations, and creates six editable primitive parts (seat, back, four legs)
labelled as a procedural chair reference. It is not a library/photoreal chair.
No identity/outfit/real-asset claim is allowed. Other rigs, tilt, scaling,
calibration, hidden/locked actors, ID conflicts and overlapping actors/props fail
without mutation. Multiple seat operations cannot target the same actor.

Fit constants come from evaluating the pinned shipped GLB with the exact viewer
rest-quaternion × pose-delta transform and +90° X conversion. Lift the seated
rig to put its lowest skin vertex on the ground. Fit the seat top to the lowest
skin vertex in a defined pelvis support region. This verifies support-region
alignment and whole-mesh ground clearance for that one canonical pose; it does
not prove general contact, physics, arbitrary rig fit or foot sole flatness.
Verify the calibration against actual skinned vertices in a Node test and record
the GLB SHA-256. Generated chair bounds use yaw-aware conservative checks against
other actors and existing objects; only the owning seated actor's fitted chair
parts are exempt from the old standing-cylinder overlap rule.

DirectorShotPackage must include poseRootOffsetM as well as joint rotations,
otherwise the same pose at different root height hashes identically. Test the
checksum and one-step undo/redo with this slice. UI must show proxy limitations,
supported pose choices and clarification/failure before any apply. A live-model
acceptance uses actual generated designContext with two actors, then compiles
the real response and checks both actors seated and cameras byte-for-byte equal.

## Crowd animation and camera cuts — 2026-10-27

The grain-shop trial needs grouped canonical white-model extras, explicit
reaction timing and movement, and multiple views on one timeline. Add
`crowd_motion` with a stable group ID, label, behavior (`avoid`, `observe`,
`pass`), and 1–20 explicit members. Each member has a stable actor ID, initial
position/yaw, destination, start time and duration. Existing actors must be
editable canonical white models; new actors use the `design-extra-` namespace.
Cap the complete visible scene at 40 actors. Missing counts and times are model
assumptions shown before application, never claims inferred from imagery.
Persist group membership in authoring state, and compile positions into normal
character-transform tracks. Observe members remain at their initial position;
avoid/pass are explicit linear spatial motion, not locomotion/contact solving.

Add `camera_cut` with time and an existing camera ID. Permit new composed
cameras only through `add_camera` (clone current lens/aspect and frame explicit
subjects); keep `frame_camera` restricted to the selected camera otherwise.
Cuts use the existing active-camera track with step interpolation. All new
operations preview without mutation and apply in one undo snapshot. Reject
conflicting member assignments, invalid timing/IDs, existing animation on first
creation, unsupported rigs, and sampled path collisions with actors/primitive
props. The checks are conservative blocking checks, not full-body collision or
line-of-sight validation. No automatic Storyboard request protocol is added.

Verification: near actors move immediately, middle actors wait before moving,
far actors continue traversing, observe actors stay put; evaluate before/at/after
reaction and cuts. Verify atomic rejection, undo/redo, bundle round-trip,
frontend/server schema parity and preview scrubber availability. Export video
through the existing browser reference recorder (10-second limit); a rendered
video and real-model interpretation still need runtime acceptance.

### Locomotion and navigation slice

Compile crowd members through deterministic 2D visibility-graph navigation
around expanded axis-aligned box bounds and stationary actor bounds. Preserve
start/destination and explicit movement duration, distributing time by route
length. Moving actors are coordinated with priority scheduling: later actors
may wait in 0.25-second increments up to 8 seconds; reject unschedulable
conflicts. Continuous segment distance checks include waiting and final holds.
No physics, full-body contact or general navmesh is claimed. Reject unsupported
obstacles, occupied goals, routes outside +/-100 m, excessive speed (>3 m/s),
and oversized navigation graphs instead of hiding failure. Save any added wait
in the compiled transform keys and report it in the proposal UI.

Bake procedural white-model gait from traveled distance into existing pose
tracks; standing and waiting have neutral pose. Orient motion toward each
segment (turn in place at corners, no claim of smooth turn/contact IK). This is
an approximate stepping reference, not motion capture or foot-contact solving.
Verify routing around counters, blocked goals, crossing flows/wait timing,
continuous clearance, gait phase vs travel, neutral holds, atomic undo and
bundle round trips. Browser skin appearance remains a separate runtime check.

### Editable street block slice

Add a bounded `street_layout` operation with a stable layout ID, road center,
width/length, building footprints (center, width/depth/height, door width,
front side) and tree anchors. Axis-aligned road runs along Y. Building frontage
faces +/-Y, with a genuine gap between front-wall piers and a lintel above.
Emit normal editable primitive objects with stable prefixed IDs, not a new
scene owner. Floor slabs end at ground height, so they do not block walking.
Trees use box proxies in this first slice to retain the current navigation
contract. Reject overlapping footprints, road/building overlap, invalid doors,
ID collisions, below-ground layouts and actors inside generated obstacles.
All dimensions are explicit model assumptions, not inferred metric truth from
reference images. Save/reuse through existing sceneObjects and design bundle.
Verify door gap, connected street entry, navigation through door, pure preview,
atomic apply/undo and schema parity. General rotated streets, roof/detail
modeling, navmesh integration and foot IK remain subsequent slices.

### Recast proxy navmesh integration

Use pinned recast-navigation 0.43.1 (MIT) via lazy WASM initialization, selected
explicitly in the design panel. Existing box mode is retained as an explicit
compatibility choice, never a fallback after navmesh failure. Official README
and installed type declarations confirm generateSoloNavMesh, NavMeshQuery,
findClosestPoint and computePath; invoke real WASM in integration tests.

Initial admission is flat-ground navigation over transformed cube proxy
geometry (positive scales and Z-axis rotations), not arbitrary imported meshes.
Convert director Z-up into right-handed Y-up (x,z,-y). Ground is a bounded
synthetic plane; geometry does not yet declare walkable street-only regions.
Reject occupied endpoints, height mismatch, unsupported geometry, excessive
rasterization bounds and partial paths. Bake accepted route into existing
transform/gait tracks and retain priority scheduling for actor avoidance.
Destroy native query/navmesh after each bounded build. No DetourCrowd physics,
foot IK, stairs or imported-model admission is claimed. Validate rotated/scaled
obstacles, shop doorway connectivity, disconnected endpoints, atomic apply,
undo and JSON round trips; browser WASM loading remains runtime acceptance.

### Canonical flat-ground leg IK

Bake analytic two-bone sagittal leg IK into crowd pose keys using measured
hip/knee/ankle rest coordinates of the shipped canonical GLB. Each foot follows
a bounded alternating support/swing target; swing lift is 6 cm and ankle
counter-rotation preserves rest foot orientation. Reject unreachable targets.
This slice solves flat-ground ankle height at authored samples, not world-space
foot locking, terrain raycasts, pelvis adjustment or arbitrary rigs. Do not
claim slip-free planted feet: the bounded foot trajectory remains approximate.
Verify FK against actual GLB bones and ankle orientation, not only formulas;
retain deterministic timeline bake, JSON round trip and existing contact limits.

### Straight-segment planted-foot slice

Replace periodic ankle offsets with alternating fixed support anchors along
each straight route segment. Swing feet advance to the next anchor with 6 cm
clearance; shorten steps to land both feet at the destination. Lower the pelvis
by up to 5 cm for reach, blending at departure/arrival. Bake pelvis offset in
pose keys separately from joint rotations; preserve legacy pose payloads.
Dense distance samples (<= 5 mm) bound interpolation error. Validate actual GLB
FK at between-key samples, support drift <= 1 cm, ankle orientation and limits.
Corner heading changes remain discrete replants, not contact-preserving turns;
terrain, arbitrary rigs and physics remain outside this slice. No rendered
appearance or universal no-slip guarantee follows from numerical validation.

### Corner stop reference

Reserve 0.25–0.65 seconds at nontrivial route corners, within the requested
arrival duration. Recheck walking speed and crowd clearance including these
holds. Replant in neutral pose and interpolate heading on the shortest arc
while stationary. This is an explicit reference pivot; no turn-step contact
or slip-free rotation is claimed. Straight-segment foot locking is unchanged.
