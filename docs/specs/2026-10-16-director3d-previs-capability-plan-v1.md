# Director 3D Previs Capability Plan v1

## Goal

Make the director table a fast, inspectable previs tool for:

- blocking people, props and spatial relationships;
- authoring camera composition and movement;
- previewing character and camera motion as white-model video;
- exporting depth, camera records and a deterministic shot description.

The browser stage is for interactive authoring and reference preview. Blender
media remains the owner of metric depth and any bounded server-side render.

## Reference

`open-ai-canvas` was inspected from its public `main` branch on 2026-10-16.
Its previs table is browser-side Three.js (`@react-three/fiber`, `three`,
`three-stdlib`) with a single scene document containing objects, cameras,
lights, environment, shots and keyframes. It uses browser capture for clay
video and material overrides for depth/normal/pose previews.

This is a UX and data-model reference. It is not evidence that browser depth
is metric or that it replaces iframe's Blender media path.

## Capability Status

| Area | Current iframe state | Target slice |
| --- | --- | --- |
| Scene and blocking | 3D characters, scene objects, transforms and visibility | Reusable empty, single actor, dialogue, blocking and prop templates |
| Character identity | Humanoid rig, actor paths, pose presets | Stable actor IDs and separate identity, pose and motion layers |
| Camera composition | Cameras, target, FOV, aspect, depth-of-field and paths | One shot package with physical lens fields and explicit framing |
| Camera movement | Path presets, keyframes and timeline evaluation | Preset-to-editable path workflow with immediate preview |
| Character movement | Actor paths, pose tracks and timeline evaluation | Fast ground-path authoring plus white-model motion preview |
| Timeline | One bounded workbench timeline | Per-shot context first; multi-shot sequence later |
| Environment | Gray preview and panorama support | Explicit background mode; panorama is not measured geometry |
| Lighting | Viewport lighting but no authored light manifest | Named key/fill/rim/environment records |
| Reference video | Browser white-model video is implemented | Add clay/pose mode choices and shot-package provenance |
| Depth | Blender-backed metric PNG/EXR and camera records | Same manifest drives depth, blocking image and prompt |
| Prompt | No unified shot compiler | Deterministic projection from authored shot package |
| Recovery | Local draft, undo and capture cleanup exist | Block stale output and preserve last valid result |

## Shot Package

Create a versioned `DirectorShotPackage` projection at export time. Existing
workbench state remains authoritative; the package is a read-only projection.

Required fields:

```text
schemaVersion
sceneId / shotId / frame / fps / duration / aspectRatio
characters: id, label, asset identity, pose, transform, visibility
objects: id, label, kind, dimensions, transform, visibility
camera: id, transform, target, focalLengthMm, fovDeg, fStop,
        focusDistanceM, clipStartM, clipEndM
lights: id, label, type, transform, color, intensity, enabled
environment: mode, panorama identity, rotation, exposure
timeline: actor/camera paths, keyframes, active-camera changes
provenance: source revision, generated-at frame, coordinate system, units
```

The package is the input to:

1. browser white-model/clay/pose preview;
2. Blender blocking PNG and metric EXR;
3. per-frame camera records;
4. structured prompt compilation.

Prompt text may add action, emotion and narrative intent. It must not mutate
coordinates, lens values, object identity, lighting or camera axis.

## UX Rules

1. **One active shot context.** Inspector, viewport, timeline and export must
   visibly refer to the same shot and camera.
2. **People first.** Add actors, establish left/right/front/back and facing,
   then choose a scene template and adjust the camera.
3. **Direct manipulation plus numeric precision.** Ground paths, camera frustum
   and target are visible in the same world space; inspectors provide exact
   meters/degrees/seconds.
4. **Preset means editable.** Templates and camera moves create ordinary
   objects, paths and keyframes that can be changed and undone.
5. **Explicit render modes.** Label composition, white-model video, pose,
   depth preview, normal and metric depth export separately.
6. **Fast reversible loop.** Template -> blocking -> pose -> camera alignment
   -> movement preset -> scrub -> record -> review -> export.
7. **No silent fallback.** Remote media failure remains failure; browser preview
   is not presented as a metric render.
8. **Capture restores authoring state.** View mode, playhead, materials,
   selections and helper visibility return after success, failure or cancel.

## Delivery Order

### Slice A: Shot package projection

- Define TypeScript schema and pure projection from current workbench state.
- Include camera, visible objects/characters, paths, frame and provenance.
- Add tests for stable IDs, units, active camera and timeline evaluation.

### Slice B: Reusable blocking templates

- Add empty, single actor, dialogue, multi-actor blocking and prop templates.
- Ensure deterministic positions and non-overlap checks.
- Make templates undoable and clearly separate from validation fixtures.

### Slice C: Reference modes

- Add browser white-model/clay and pose capture choices.
- Keep metric depth submission on the existing Blender media route.
- Attach the shot package checksum to every local reference result.

### Slice D: Blender manifest and prompt compiler

- Extend the media snapshot with semantic objects, lights and physical camera
  fields, including real f-stop rather than a browser post-process coefficient.
- Generate blocking PNG, metric EXR, camera records and structured prompt from
  one manifest.

### Slice E: Multi-shot sequence

- Add shot list and per-shot camera context only after single-shot package
  parity is proven.

## Acceptance Criteria

- A two-person dialogue fixture preserves identity, facing, depth order and
  camera target through browser preview and package export.
- A moving actor and moving camera produce the same evaluated frame state in
  the viewport, white-model video and package records.
- A 35mm / f2.8 / 5m camera remains distinguishable as focal length, f-stop and
  focus distance in the exported manifest.
- Blender output contains metric EXR, preview PNG and camera records whose
  frame, resolution, aspect and coordinate system match the package.
- Prompt text can be regenerated from the package without changing authored
  scene state.
- Cancel, failure and close during capture restore the prior authoring state.

## Evidence Boundaries

- **Code fact:** open-ai-canvas uses browser Three.js previs and browser media
  capture; its schema explicitly stores camera, light, object and shot data.
- **Code fact:** iframe already evaluates authored camera/actor paths and has
  browser white-model video plus Blender metric depth.
- **Direct implication:** a shared shot package reduces drift between preview,
  depth, camera records and prompt text.
- **Not yet proven:** any reference image or video improves downstream model
  consistency; this requires comparative generation tests.
