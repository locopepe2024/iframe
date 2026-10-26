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

The 3D director is the review gate, while the existing asset library is the
durable reuse owner. A natural-language generation request remains
director-scoped and must not enter storyboard state. After the director
reviews, adjusts or rejects the generated depth, blocking image, camera-motion
reference video and action reference video, an approved result is saved through
the normal asset admission path. Later shots and storyboards read ordinary
asset variants by stable asset/variant/media IDs; they do not read the
transient generation request or mutate the director scene through that
reference.

This separates three meanings that must not be conflated:

- the director scene is the editable spatial source;
- the reviewed ordinary asset variant is the reusable reference artifact;
- a storyboard shot is a read-only consumer binding.

An approved director result therefore creates an ordinary asset variant with
the existing asset-library identity and media lifecycle. Optional provenance
metadata may record the source director revision, package checksum, frame,
camera, purpose, media status and source hashes. A later director correction
uses the existing normal asset revision/variant flow; it never rewrites a
library variant already used by a shot. Deleting or replacing the current
director scene does not silently change an existing library reference.

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
PATCH /director3d/reference-generation-results/{request_id}/review
existing project asset admission route for the selected asset type
```

The final admission uses the existing asset-library path for the selected
asset type (image, depth artifact or video). It is allowed only after director
review is approved. It is not a direct storyboard write and must not be owned
by the director scene. The response exposes the normal `asset_id`,
`variant_id` and `media_id` values that storyboard consumers bind read-only.

The identity levels are distinct:

```text
asset_id
  existing asset-library identity

variant_id
  existing approved output variant

media_id
  existing concrete PNG, depth artifact or video file identity
```

Use the existing asset revision and variant rules. A director correction must
create a new ordinary variant or revision according to those rules; a
`media_id` is never overwritten. No director-specific asset hierarchy is
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
