# Targeted Subject Motion Bundle v1

## Observed

- The current recreation test contains three visible people.
- The requested operation is to replace only the center person with a supplied PNG character reference.
- H3, Seedance, and Wan 3 are currently consumed through ordinary image/video reference inputs; the iFrame adapter does not submit provider-native pose or depth-control fields.
- The media host has Blender 4.5.9 LTS, a white-model rig, motion-clip retargeting, camera/reference-video export, and shot-control-bundle concepts.
- The media host does not currently expose a verified automatic video-to-pose extractor in the director runtime.
- A media-host headless Blender smoke test rendered a three-actor scene from a JSON state. The output manifest recorded `preserve-left`, `target-center`, and `preserve-right` as separate actors.
- The same renderer can emit a still reference and an MP4 camera/motion reference. The still completed successfully at 640x360; the MP4 path is valid but CPU-bound on the current four-CPU host and must be tested with a short smoke profile before a full render.

## Direct implication

- Subject selection and target tracking must be explicit before any paid provider request.
- The center subject needs an owner-stable subject ID, a per-frame track, a mask, and a confidence/occlusion record.
- The left and right subjects are preservation context. They must not be silently treated as identity references for the replacement subject.
- Provider submissions should snapshot the target subject ID, source fingerprint, control-bundle revision, and reference-role mapping.

## Not yet proven

- Whether ordinary multi-video references cause H3, Seedance, or Wan 3 to follow the target subject motion rather than regenerate a semantically similar scene.
- Whether a white-model or silhouette video improves target-subject motion retention for any of the three providers.
- Whether the current media director can import an automatically extracted track without a new extractor and skeleton-mapping adapter.
- Whether a full-duration render is operationally acceptable without a low-resolution/low-sample preview profile.
- A 24-frame, 1-second, 640x360, single-sample MP4 smoke test completed and ffprobe reported 24 frames at 24 fps.
- MediaPipe Pose Landmarker Lite ran on the supplied 1394x792 test clip in an isolated Python 3.12 venv. The first 120 sampled frames produced a JSON track and overlay video.
- On those 120 samples, the extractor detected 1, 2, or 3 people depending on the frame. The center target was tracked on 79 samples and marked `occluded` on 41 samples instead of silently assigning a left/right person.
- A 2D landmark-to-Blender adapter converted the 79 tracked samples into per-frame root positions and rotations for the existing shoulder/elbow/hip/knee controls. A 24-frame, 1-second white-model MP4 smoke test completed successfully.
- The track validator reports a source-frame sampling step of 2 and a tracked ratio of `0.6583`; it reports occlusion ranges in source-frame coordinates rather than expanding them into unsampled frames.
- The adapter now preserves source timing: the 30.687 fps source is compiled to a declared 24 fps Blender timeline of about 7.79 seconds.
- A 12-tile contact sheet was generated for director review. It shows the yellow center subject remains visually present during at least one `occluded` frame, demonstrating that `occluded` currently means detector miss/selection uncertainty, not confirmed physical disappearance.

## Blender white-model boundary

**Observed:** `blender/render_director_reference.py` creates multiple procedural actors, applies pose presets, keys root trajectories and camera motion, and writes a versioned `director_reference_manifest.v1`.

**Direct implication:** Blender can be the downstream compiler for a reviewed `motion-track.v1`; it can produce a white-model animation asset for director review and as a candidate reference video. The target actor must remain a named actor in the state and manifest (`target-center` in the smoke test), while preservation actors remain separate.

**Not yet proven:** The current renderer does not consume an automatically extracted per-frame pose track. Its existing actor input is state-level pose/trajectory data, so an adapter is still required between `motion-track.v1` and Blender actor keyframes.

**What would verify it:** Import a fixture containing at least 24 frames of target joint rotations and root positions, render a short MP4, and compare the manifest plus sampled overlay frames against the source track.

**Smoke-test result:** A fixture with five target samples (frames 1, 6, 12, 18, and 24) rendered successfully. The manifest retained all three actor IDs and the MP4 was decoded as 640x360, 24 frames, 1.0 seconds. This verifies the renderer path, but not pose accuracy against an extracted source video.

## 2D extractor boundary

**Observed:** MediaPipe Pose Landmarker Lite can emit up to three pose candidates per sampled frame and a target overlay. A naive detector-index or center-only selector changed identity when the three-person portion appeared. Visual inspection showed the yellow center person selected initially, then a left male selected after the center pose was absent from a frame.

**Direct implication:** `motion-track.v1` must carry a target selection status and explicit occlusion gaps. A missing center detection cannot be filled by copying a neighboring person's pose.

**Current fixture policy:** the smoke extractor uses a center prior plus continuity score; if no candidate lies within the center corridor, it emits `selection_status: "occluded"` and leaves target landmarks absent. This is a review signal, not an assertion that the person is physically absent.

**Not yet proven:** The center corridor is a test-specific heuristic. It is not sufficient for arbitrary camera pans, lateral subject movement, or shots where the target is not centered.

## 2D-to-Blender mapping boundary

**Observed:** `tools/motion_track/pose_to_blender_state.py` maps MediaPipe landmark pairs to image-plane joint angles and emits a director state with the tracked samples attached to `target-center`. The media Blender renderer consumed that state and produced a 24-frame MP4 while preserving the three actor IDs.

**Direct implication:** The system now has a testable vertical slice from sampled 2D landmarks to a white-model reference asset. The result is useful for reviewing timing, rough limb direction, subject identity, and occlusion gaps.

**Not yet proven:** This is not a physically valid 3D retarget. The root position is an image-plane proxy, depth is absent, left/right camera perspective is not solved, and the angle convention is a temporary adapter contract.

**What would verify the next boundary:** Compare mapped white-model joint directions against manually reviewed keyframes at the start, center, and end of the source clip, then replace the planar adapter with a calibrated 3D lift or SMPL/SMPL-X mapping.

### Current axis contract (v4)

**Observed:** The current adapter uses three root translation axes and one effective joint rotation axis:

```text
root.location.x = image x displacement
root.location.y = bounded MediaPipe depth estimate
root.location.z = inverted image y displacement
joint.rotation_euler.x = 0
joint.rotation_euler.y = planar landmark angle minus rest baseline
joint.rotation_euler.z = 0
```

The state advertises `XYZ` Euler values, but the generated values are `[0, angle, 0]` for the eight tracked limb segments. The other rig bones are not driven by the motion adapter.

**Direct implication:** The white-model output currently has 3-axis root translation plus single-axis planar limb rotation. It is not a full 3D skeletal retarget, even though the state contains three-component position and rotation arrays.

**Observed correction:** The source track contains left and right hip landmarks for all 79 tracked samples. The previous Blender adapter used their midpoint only for root translation; it did not write a `pelvis` or `spine_*` pose. The adapter now records `body_centers.hips`, `body_centers.shoulders`, and `pelvis_width`, and emits legacy planar rotations for `pelvis`, `spine_lower`, `spine_mid`, and `spine_chest`. This proves hip data is present and consumed by the state generator, but does not yet prove the retargeted pelvis motion is anatomically correct.

**Not yet proven:** Whether the target rig's local bone axes happen to align closely enough with the adapter's Blender-Y assumption for any particular shot. The current v4 render shows the output is not reliable as a dance-action reference.

**Next implementation slice:** Add an explicit `retarget_mode` and per-joint source/target vectors to the state. The Blender adapter should compute a quaternion delta from each target bone's rest vector to the source pose vector in the parent rest frame, then apply that delta in local bone space. Existing Euler states remain readable as a legacy mode until the vector path is validated.

The review artifact is generated by `tools/motion_track/render_track_review.py` and should be attached to the track revision before approval.

## Review bundle

`tools/motion_track/build_motion_review_bundle.py` binds the source video fingerprint, `motion-track.v1`, validator summary, contact sheet, and Blender state/manifest into `motion-review-bundle.v1`. New bundles start as `review_status: "needs_director_review"` and explicitly list what the artifacts prove versus what remains unproven.

The bundle contract is defined in `config/recreation/schema/motion-review-bundle.v1.schema.json`; `tools/motion_track/validate_motion_review_bundle.py` validates the artifact before it is consumed by the review UI.

The regenerated media bundle uses `center_prior_with_continuity_and_occlusion`, records 79 tracked and 41 occluded samples, and remains `needs_director_review` until the contact sheet is accepted by a director.

## Track quality gate

The validator must pass before a track can be promoted to a control bundle. It checks monotonic source frames, normalized bounding boxes, explicit `tracked`/`occluded` statuses, source-frame sampling step, and tracked ratio. A passing validation does not mean the pose is accurate; it only means the track is structurally reviewable.

## Control bundle contract

```json
{
  "schema": "recreation-control-bundle.v1",
  "source": {
    "media_id": "...",
    "sha256": "...",
    "start_seconds": 0,
    "end_seconds": 10,
    "fps": 30,
    "width": 1394,
    "height": 792
  },
  "scene": {
    "subject_count": 3,
    "target_subject_id": "person-center",
    "preserve_subject_ids": ["person-left", "person-right"]
  },
  "target": {
    "selection_frame": 0,
    "selection_bbox": [0, 0, 0, 0],
    "track": "target-track.json",
    "mask_video": "target-mask.mp4",
    "pose_video": "target-pose.mp4",
    "white_model_video": "target-white-model.mp4"
  },
  "scene_controls": {
    "camera_track": null,
    "depth_video": null,
    "silhouette_video": null
  },
  "references": {
    "target_identity_image": "target.png",
    "source_video": "source.mp4"
  }
}
```

## Processing slices

1. Read-only source normalization and contact-sheet generation.
2. Subject selection at a reference frame and stable subject ID.
3. 2D target tracking and mask confidence validation.
4. Optional 3D lifting and Blender retargeting.
5. White-model/mask/control-video export.
6. Provider A/B/C comparison with identical seed and duration.

## Success criteria

- The target track identifies the center subject for every sampled frame or records an explicit occlusion gap.
- The two preserved subjects remain distinct in the track manifest.
- The generated control bundle is reproducible from source fingerprint and revision.
- Provider experiments can report which reference video served motion, scene, camera, or depth roles.
- No paid request is submitted before the target overlay is visually approved.

## Verification commands

```bash
ffprobe -v error -show_entries format=duration:stream=index,codec_type,width,height,r_frame_rate -of json <source>
ffmpeg -hide_banner -loglevel error -ss <time> -i <source> -frames:v 1 <frame.jpg>
```

## Boundaries

- This slice does not claim provider-native ControlNet, OpenPose, or depth support.
- This slice does not add automatic segmentation or pose extraction until the extractor and license are selected.
- This slice does not submit another paid generation while target selection is unverified.

## Hypit motion boundary

**Observed:** Hypit's `@hypit/media-track` motion recipes operate on timed visual Items, Sequences, Frames, and sampled media. The supported operators include `fade`, `slide`, `scale`, `bounce`, `wipe`, and `spin`; their outputs are visual properties such as opacity, transform, filter, and clip-path keyframes.

**Direct implication:** Hypit motion is suitable for compositing and timeline presentation: B-roll entrance, card movement, caption/sticker animation, transitions, and whole-media pan/zoom/rotation. It is not a body pose or skeleton control channel.

**Not yet proven:** Hypit's provider packages do not establish that H3, Seedance, or Wan will interpret a media-track motion recipe as human motion guidance. The provider-facing H3 surface remains ordinary text, image, video, and audio references.

**System boundary:** iframe/media owns subject selection, masks, `motion-track.v1`, 3D lift, Blender retargeting, and white-model reference generation. Hypit-style visual motion belongs to the upper composition layer and must not be used as a substitute for joint trajectories.

## Hypit-inspired process management boundary

This section is a process-management reference, not a claim that iframe adopts Hypit's runtime implementation.

**Observed:** Hypit separates a durable project definition from executable runs, provider bindings, and collected outputs. Remote work is managed as a checkpointable lifecycle (`start` → `poll` → `collect`), and results are retained as reusable outputs with evidence. The iframe recreation flow currently has project, timeline, generation task, and assembly concepts, but the UI does not yet expose one stable control-bundle revision or a complete provider-attempt record.

**Direct implication:** the recreation pipeline should make these boundaries explicit:

```text
Recreation Project
  → Recreation Plan / Control Bundle Revision
  → Generation Attempt
  → Result Repository Output
```

- **Project** owns the source media, timeline, target subject identity, and preservation subjects.
- **Plan / Control Bundle Revision** is an immutable snapshot of the approved source fingerprint, target track revision, reference-role mapping, output ratio, duration, and selected provider capability route.
- **Generation Attempt** records provider, catalog capability snapshot, request ID, remote task ID, start/poll/collect state, retry lineage, cost acknowledgement, and terminal error.
- **Result Repository Output** stores generated media, assembly outputs, manifests, previews, and the evidence links needed to compare an attempt with the source and control bundle.

**Checkpoint contract:** each remote attempt must persist its provider task identity before polling. Polling must be resumable after a page refresh or worker restart; collection must be a distinct state that records the final output identity and checksum. A retry creates a new attempt linked to its predecessor instead of mutating the old attempt.

**Route snapshot:** the plan must retain the exact catalog capability snapshot used for submission. This is where iframe records whether the provider was called as `t2v`, `i2v`, `r2v`, or `f2v`, plus the declared reference roles. Pose, depth, OpenPose, ControlNet, or SMPL fields may only be included when the catalog explicitly declares them; a provider name or free-form parameter is not evidence of support.

**Review gate:** `motion-review-bundle.v1` remains `needs_director_review` until the target overlay/contact sheet and white-model preview are accepted. The UI should show this state before the submit action and prevent a paid attempt while the bundle is unresolved. Approval should produce a new control-bundle revision rather than silently changing the existing one.

**Studio Companion reference:** Hypit's semantic timeline editing suggests a useful iframe separation: the director can edit shot meaning, target identity, action intent, camera intent, and replacement instruction at the semantic layer, while generated tracks and provider payloads remain derived artifacts. Editing a description must invalidate the affected plan revision and require a fresh plan check; it must not rewrite a completed attempt or result.

**Not yet proven:** the current iframe API persists all of these fields durably across worker restarts, and the current provider adapters expose a first-class collect phase distinct from task completion. These are implementation gaps to verify before presenting the lifecycle as complete.

**What would verify it:** inspect the recreation task schema and worker restart behavior, then run a test attempt through start, forced process restart, resumed poll, collect, retry, and result comparison. The UI should be able to show the same attempt lineage and control-bundle revision after reload.

## Recreation UI interaction review

**Observed:** the recreation page presents split, parse, analyze, replace, submit, and assemble as a horizontal workflow. Before this change, every step button was clickable even when its required project state was absent. The page already explains some blocked content after navigation, but the navigation itself did not communicate that the step was unavailable.

**Direct implication:** navigation now follows the current data boundary: parse is available after source registration, analyze after analysis exists, and replace/submit/assemble after the timeline is confirmed. Disabled steps remain visible so the user can see the complete process, while keyboard users cannot focus or activate an unavailable action.

**Not yet proven:** the UI does not yet receive a durable `motion-review-bundle.v1` from the API, so it cannot show target-subject selection, tracked/occluded ratios, white-model preview, or director approval as live project state. The current contact sheet is a visual analysis artifact and is not an approval record.

**Hypotheses:** once the backend exposes the review bundle, the analyze stage should become a review checkpoint with target overlay, occlusion summary, white-model preview, and an explicit approval transition. The submit stage should show the immutable control-bundle revision and catalog route snapshot before the cost acknowledgement.

**What would verify it:** add a fixture project carrying a review bundle, reload the page at each stage, and verify that the same review status, bundle revision, and generation-attempt lineage survive navigation and refresh. Add an interaction test that a paid-submit control is unreachable until approval and a saved plan exists.

**Implemented slice:** the submit-stage task rows now expose the selected model, local task ID, persisted provider task ID (or an explicit pending state), control revision, and last update time. This makes the existing recovery checkpoint visible after reload without claiming that a separate `collect` endpoint already exists.

## Resolution capability evidence correction

**Observed:** the deployed iframe worker and the current branch use different request values: the deployed container sends `768p`, while the current branch sends `720p`. The deployed `/recreation/models` response declares H3 options `720p` and `2k`. The upstream compatibility statement that UniArt accepts both `720p` and `768p` is a separate fact and does not by itself prove that iframe's catalog maps `768p` as a selectable H3 option.

**Direct implication:** `768p` must not be labeled unsupported solely because the recreation worker sends it. The actual boundary to fix is catalog-to-worker consistency: the selected resolution should come from the catalog snapshot or an explicitly documented provider alias mapping.

**Not yet proven:** whether the deployed H3 route accepts `768p` for this exact reference-video request, and whether the gateway normalizes it to the catalog's `720p` or treats it as a distinct output profile.

**What would verify it:** submit one controlled non-production request using the exact deployed route and `768p`, capture the provider request/response metadata and output dimensions, then compare it with the catalog's `720p` request. Do not infer support or rejection from the field name alone.
