# Virtual Actor Identity And Pose References V1

Status: contract slice; provider ControlNet execution is not enabled.
Date: 2026-09-20

## Observed

- Characters already have a canonical `reference_sheet` with stable image
  variant IDs.
- Storyboard frames already persist per-shot reference variant selections.
- The current runtime has no verified UniArt ControlNet/OpenPose/Depth request
  contract. A comment or ordinary reference image is not a ControlNet input.
- Public director-desk implementations provide useful local pose and camera
  editing, but their snapshots are not yet part of iFrame's durable project
  schema.

## Direct implication

iFrame needs to distinguish three kinds of visual evidence:

1. Identity evidence: makeup/reference sheet images that define a virtual
   actor's face, hair, skin, costume and body proportions.
2. Pose evidence: a selected pose image or director-desk snapshot describing
   body posture, gesture and staging.
3. Control evidence: a derived OpenPose/Depth/Edge map sent only when the
   selected model declares that exact control type.

The first two can be persisted now without changing provider payloads. The
third remains capability-gated.

## Contract

- `Character.makeup_reference` and `Character.pose_references` are optional
  `AssetUnit` containers. Old characters deserialize unchanged.
- `StoryboardFrame.workbench_pose_reference_variant_ids` stores ordered
  variant IDs keyed by semantic asset ID.
- `StoryboardFrame.workbench_director_snapshot_media_id` stores a durable
  media identifier, never a short-lived signed preview URL.
- `VideoTask` snapshots the selected pose IDs and director snapshot media ID so
  a retry cannot silently change the design inputs.
- `UpdateFrameWorkbenchRequest` accepts and validates these fields using the
  same owner/revision checks as existing reference variants.
- H3/Seedance continue to receive ordinary ordered reference images. A future
  provider adapter may add `pose_control` only after the model catalog declares
  a verified contract.

## Not yet proven

- Whether UniArt MiniMax H3 accepts OpenPose, Depth or any ControlNet field.
- Whether a provider uses a pose image as a hard spatial constraint or only as
  a soft visual reference.
- Whether a director-desk screenshot is sufficient for identity preservation
  without a separate makeup/reference sheet.

## Success criteria

- Existing projects load without migration errors.
- Character identity and pose containers survive save/reload.
- A shot's pose selection and director snapshot survive refresh.
- A created video task contains an immutable copy of those selections.
- No unsupported `controlnet`, `openpose`, `depth`, or `pose_control` field is
  sent by the current UniArt adapters.

## Affected paths

- `src/apps/comic_gen/models.py`
- `src/apps/comic_gen/api.py`
- `src/apps/comic_gen/pipeline.py`
- `frontend/src/store/projectStore.ts`
- focused model and workbench persistence tests
