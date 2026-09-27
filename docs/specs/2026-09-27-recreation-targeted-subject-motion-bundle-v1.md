# Targeted Subject Motion Bundle v1

## Observed

- The current recreation test contains three visible people.
- The requested operation is to replace only the center person with a supplied PNG character reference.
- H3, Seedance, and Wan 3 are currently consumed through ordinary image/video reference inputs; the iFrame adapter does not submit provider-native pose or depth-control fields.
- The media host has Blender 4.5.9 LTS, a white-model rig, motion-clip retargeting, camera/reference-video export, and shot-control-bundle concepts.
- The media host does not currently expose a verified automatic video-to-pose extractor in the director runtime.

## Direct implication

- Subject selection and target tracking must be explicit before any paid provider request.
- The center subject needs an owner-stable subject ID, a per-frame track, a mask, and a confidence/occlusion record.
- The left and right subjects are preservation context. They must not be silently treated as identity references for the replacement subject.
- Provider submissions should snapshot the target subject ID, source fingerprint, control-bundle revision, and reference-role mapping.

## Not yet proven

- Whether ordinary multi-video references cause H3, Seedance, or Wan 3 to follow the target subject motion rather than regenerate a semantically similar scene.
- Whether a white-model or silhouette video improves target-subject motion retention for any of the three providers.
- Whether the current media director can import an automatically extracted track without a new extractor and skeleton-mapping adapter.

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
