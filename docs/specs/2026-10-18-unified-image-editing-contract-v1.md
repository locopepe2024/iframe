# Unified image editing contract v1

## Decision

The generic image editor and the scene lighting/camera tools share one reviewed
image editing workflow and one submission contract. They remain separate editing
modes because their semantics differ.

## Modes

- `freeform`: generic image editing with a source image, optional ordered
  references, and an explicit prompt.
- `scene_lighting`: derive a scene image from one selected scene variant, with
  validated light direction, color, brightness, preset, and optional lighting
  reference.
- `scene_camera`: derive a scene image from one selected scene variant, with
  validated yaw, pitch, shot size, and optional image-coordinate focus.

## Canonical submission projection

Every mode must produce the same reviewable projection before generation:

```text
source_variant        stable source identity, when applicable
ordered_references    stable ordered media identities
edit_mode             freeform | scene_lighting | scene_camera
structured_parameters mode-specific validated parameters
compiled_prompt       complete text sent to the image model
negative_prompt       complete negative text
model_id              selected image model
aspect_ratio          selected output ratio
review_fingerprint    hash over all submitted fields
```

The user must be able to inspect the complete compiled prompt and all
structured parameters before confirmation. No mode may append hidden prompt
text after confirmation.

## Ownership and persistence

- The generic editor owns freeform pixel operations and its exported image.
- The scene tools own scene derivation parameters and source-variant lineage.
- The shared review component owns confirmation, fingerprint display, and the
  final submission boundary.
- A generated result is a new media variant. It must retain its source variant,
  mode, structured parameters, and reviewed prompt.

## Out of scope

- Do not make scene lighting or camera parameters available to character or
  prop editing by default.
- Do not infer scene continuity or automatically inherit a previous shot.
- Do not combine prompt text from unrelated hidden director or shooting-plan
  fields after the review step.

## Migration slices

1. Add a shared TypeScript request/projection type and mode labels without
   changing runtime behavior.
2. Adapt `AssetImageSubmissionReview` and the asset generation API to accept
   the mode explicitly while preserving the existing `scene_tool` payload.
3. Add a unified image-edit entry shell that selects `freeform`,
   `scene_lighting`, or `scene_camera`; keep existing editors as mode panels.
4. Add contract tests for prompt visibility, ordered references, source lineage,
   and rejection of mismatched fingerprints.

## Success criteria

- Existing generic image-editor tests remain green.
- Existing #172 scene-tool tests remain green.
- A review snapshot can distinguish freeform, lighting, and camera edits.
- The backend rejects a mode/parameter mismatch before enqueue.
- The final provider request contains exactly the reviewed prompt and ordered
  references.
