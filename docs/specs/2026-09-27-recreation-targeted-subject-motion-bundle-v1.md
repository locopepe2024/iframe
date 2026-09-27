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
