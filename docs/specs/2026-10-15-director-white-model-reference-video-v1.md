# Director white-model reference video v1

## Goal

From the authored 3D stage, create a short reference video that shows character
motion and the active camera's motion together. The result is for inspecting
blocking, occlusion and camera movement before image or final video generation.

## Evidence and assumptions

- Code fact: the browser stage already evaluates actor paths, pose tracks,
  camera paths and active-camera tracks at each timeline frame.
- Code fact: the existing Blender full-motion renderer consumes a retargeted
  single-rig bundle and uses a fixed camera. It cannot render the complete
  browser timeline without a new scene/camera contract.
- Code fact: PR #74 renders a static depth snapshot on media. It does not
  render a moving white-model video.
- Assumption: a browser recording of the same camera canvas is the shortest
  useful path to a faithful, fast reference video. Video encoding support is
  browser-dependent; the UI must report unsupported browsers clearly.

## Slice 1: browser reference video

1. Add a record command next to the timeline playback controls. Record the
   current authored timeline from frame 1 through its configured end, using
   the active camera at each frame. Do not modify the authored scene or draft.
2. Capture the camera canvas at the output aspect ratio. Suppress authoring
   handles, path lines, camera frustums and selection emphasis in the recording.
3. After recording, show an in-page video player and download action. Keep the
   last result until replaced or the workbench unmounts; release its object URL.
4. Expose progress, cancellation, and explicit errors. Restore the original
   view and playhead after success, failure or cancellation.
5. Limit v1 recordings to 10 seconds and 30 fps so the browser operation stays
   bounded. The selected camera's aspect ratio determines the recording canvas
   ratio; the recording is a visual reference, not a metric depth export.

## Boundaries

- No external video ingestion or video-to-white-model conversion.
- No upload, backend task, or persistence of the recorded file in v1.
- Static metric PNG/EXR stays owned by the existing depth job.
- Blender media rendering requires a later authored-scene timeline contract
  covering all visible characters, scene objects, camera poses and frame rate.
  The existing retarget bundle is not that contract.

## Acceptance

- A path-moving character and path-moving camera both change across recorded
  frames; the recording uses the same frame evaluator as viewport playback.
- Switching active cameras on the timeline is reflected in the recording.
- The UI can play and download the result, cancel an active recording, and
  explain unsupported capture/encoder capabilities.
- Stopping or failing restores the view and playhead and leaves local draft
  state untouched.

## Affected paths and verification

- `frontend/src/components/director3d/scene/HumanoidStage.tsx`
- `frontend/src/components/director3d/timeline/TimelinePanel.tsx`
- `frontend/src/components/director3d/reference/WhiteModelVideoRecorder.tsx`
- `frontend/src/components/director3d/reference/record-white-model-video.ts`
- Focused Vitest tests for recording control and cleanup.
- `cd frontend && npm run test:ui -- --run ...` and `npm run typecheck`.

## Later slice: media render

Define and validate an authored-scene timeline manifest before adapting the
Blender worker. The media render should sample exactly the same evaluator,
render the same active camera for each frame, and return video, per-frame camera
records and optional depth. Validate output against the browser recording on
two-character occlusion and moving-camera fixtures. Do not treat the static
depth worker or fixed-camera retarget renderer as proof of this behavior.

## Blocking workflow reference

The [shot-layout guide](https://xjstoryboard.com/help/shot-layout-guide)
describes a useful order: place people, choose a preset or empty scene, refine
positions and facing, then move the camera and adjust framing. Its preset scenes
serve spatial relationships (person relative to table, door or wall), not a
promise that final generated art matches the 3D decoration. Blocking is most
valuable for multiple people and ambiguous foreground/background relationships.

- Code fact: the director stage stores people, objects and cameras in 3D space,
  evaluates their positions at timeline frames, and can record the active camera.
- Code fact: its two built-in scenes are labeled validation scenes. They do not
  constitute a reusable location preset library or a cross-shot scene asset.
- Product implication: the next usability slice should offer reusable spatial
  scene presets and a fast people-first blocking workflow, then keep camera
  framing and the white-model motion preview within that same authored scene.
- Not yet proven: the recorded video or static depth output improves downstream
  image/video generation consistency. That requires an explicit reference-input
  integration and comparative generation tests.

## Blender export contract for depth and blocking references

The supplied shot description is a scene manifest, not a free-form prompt to be
reinterpreted by an image model. Blender should be the source of truth for both
the blocking PNG and metric EXR:

- camera: frame, transform/matrix, focal length, sensor, FOV, aperture,
  focus distance, clip planes, target and active-camera identity;
- blocking: stable object/character IDs, labels, world transforms, dimensions,
  facing, visibility and occlusion-relevant geometry;
- lighting: named key/fill/rim/environment lights, direction, energy, color and
  enabled state;
- render: aspect, resolution, unit scale, frame range and the exact Blender
  revision.

Code fact: the current depth exporter records metric depth and a camera record,
but the browser depth snapshot does not yet carry semantic object or light
records. Direct implication: a generated prompt that lists sofa/table/bed
coordinates or light values would currently be partly unsupported. The next
media slice must export a versioned Blender manifest and derive the prompt,
blocking PNG and EXR from that same manifest. It must preserve the authored
coordinate system and never infer missing objects from prompt text.

The example's `35mm`, `f/2.8` and `5m` refer to three distinct physical camera
parameters. The browser camera's `depthOfField.aperture` is a BokehPass shader
coefficient, so it must not be presented as an f-number. Blender must record
its actual lens focal length, f-stop and focus distance independently. Coordinates
such as the single sofa at `(-75.73, 0.5, -123.54)` should be checked against
the same scene origin and camera frustum; they may be outside the proposed
8.5m shot, but are not proof of an error without the camera pose and bounds.

## Reference implementation: open-ai-canvas previs

Source reviewed: `locopepe2024/open-ai-canvas`, `main`, read-only on
2026-10-16. Relevant files include `web/src/types/previs.ts`,
`web/src/lib/canvas/previs/previs-prompt-compiler.ts`,
`web/src/lib/canvas/previs/previs-templates.ts`,
`web/src/components/canvas/previs/previs-viewport-capture.ts` and the previs
workbench/inspector/sequencer components.

### Observed

- Code fact: `PrevisScene` is a single scene document containing objects,
  cameras, lights, environment, shots and an active shot. Objects contain
  transforms, visibility, actor archetypes, poses, motion paths and keyframes.
- Code fact: cameras explicitly store position, target, focal length, FOV,
  aperture, focus distance, near/far planes and keyframes. Lights store type,
  transform, color, intensity and shadow state.
- Code fact: templates include `empty`, `monologue`, `dialogue`, `blocking` and
  `product`. The dialogue/blocking templates establish non-overlapping actor
  positions and facing before camera adjustment; the shared three-point rig
  uses key/fill/rim-style light records.
- Code fact: `compilePrevisPrompt` derives shot size, camera movement, physical
  camera values, environment, visible object coordinates, actor identity/color,
  asset references and light values from the scene document. The prompt is a
  projection of authored state rather than a second source of truth.
- Code fact: the viewport supports beauty, clay, pose, depth and normal capture;
  clay video records the authored camera view while temporarily applying clay
  materials and restores the previous render state afterward.
- Code fact: the workbench has a shot inspector, camera inspector, object/bone
  inspectors, a sequencer with camera/object/bone keyframes, camera alignment,
  camera movement presets, templates and save/close guards.

### Direct implication

The strongest reusable idea is a **shot package**: authored scene state,
active shot, camera/lens settings, lighting, blocking objects and derived
outputs stay linked. The prompt shown in the user example can be generated
deterministically from this package. Reference captures should be explicit
render modes (clay/depth/pose), rather than separate ad hoc exports.

### Current iframe gap

- Code fact: iframe has equivalent lower-level state for characters, scene
  objects, cameras, paths, depth snapshots and timeline evaluation, but these
  are spread across workbench state and panels rather than one shot package.
- Code fact: iframe has browser white-model video and media depth PNG/EXR, but
  the browser depth snapshot currently carries geometry and camera data, not
  semantic object labels or light records.
- Not yet proven: open-ai-canvas's browser capture is a production-quality
  replacement for media Blender. It uses `captureStream` and clay/depth
  material overrides; it does not establish metric EXR correctness or remote
  failure semantics.

### Recommended migration order

1. Add a versioned `DirectorShotPackage` projection for one active shot. Keep
   existing workbench state authoritative and derive the package at export time.
2. Add reusable blocking templates: empty, single actor, dialogue, multi-actor
   blocking and prop/product. Templates should be deterministic and create
   non-overlapping positions, facing and a usable starter camera.
3. Add explicit render modes for browser preview: clay/white-model, pose and
   depth preview. Keep metric depth PNG/EXR owned by the media path.
4. Compile the structured prompt from the package, including a provenance
   manifest. Do not let prompt text mutate coordinates, lens values or lights.
5. Add shot-package parity tests: prompt values, viewport capture, Blender
   manifest and camera records must agree for the same frame.
