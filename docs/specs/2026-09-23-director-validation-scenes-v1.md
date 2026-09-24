# 3D 导演台验证场景与动作参考 V1

## Status

Design and implementation specification for two browser-local validation
scenes. This slice creates deterministic white-model blocking data; it does
not claim automatic video-to-motion capture or model-video rendering.

The follow-up action catalog and historical-video handoff contract is defined
in [`2026-09-23-director-action-structure-agent-v1.md`](./2026-09-23-director-action-structure-agent-v1.md).

## Observed

- **Code fact:** the director workbench currently has two initial humanoids,
  parametric scene objects, camera composition, actor/camera paths, pose
  presets, path events, and bounded timeline keyframes.
- **Code fact:** the pose catalog already contains `seated.sit`, `action.guard`,
  `action.kick`, `action.throw`, `interaction.push`, and related blocking
  poses.
- **Code fact:** the browser draft serializes authoring state locally, while
  the director V1 boundary explicitly excludes generation jobs, standalone
  director APIs, and durable server project persistence.
- **Code fact:** reference-video scene objects can represent an admitted input,
  but the current browser surface has no user-video upload, frame extraction,
  pose solver, or rendered-animation export contract.

## Direct implication

- A deterministic preset is the smallest useful way to validate a three-person
  indoor wide shot and a 15-second fight blocking workflow without inventing a
  backend or an unverified motion-capture path.
- The fight preset can validate timeline/keyframe/path-event semantics and
  camera coverage, but it cannot prove that an uploaded fight video has been
  converted into faithful skeleton motion.
- The material-to-reference workflow must be split into measurable stages:
  media admission, frame sampling, human/keyframe annotation, white-model
  blocking, review, and only then optional animation-video rendering.

## Not yet proven

- Whether the existing white-model rig is sufficient for the supplied fight
  footage's camera angle, occlusion, contact, and motion range.
- Whether a provided video has stable timecode, usable frame rate, enough
  subject visibility, or a license that permits processing and derivative
  reference output.
- Whether any future pose solver or video renderer can preserve foot contact,
  hand contact, depth ordering, and camera motion without manual correction.

## Hypotheses

- A three-person sofa preset will expose framing, scale, seated-pose, and
  occlusion issues before real footage is introduced.
- A 15-second two-person fight blocking preset with explicit pose keyframes and
  contact/export markers will provide a useful acceptance baseline for later
  frame-to-motion work.
- Sampling a supplied 15-second clip at phase changes (contact, recoil,
  recovery, and end pose) is more diagnostic than treating every frame as a
  solved motion target.

## Preset A: indoor sofa wide shot

- Three female white-model actors: A, B, and C.
- Seated pose applied to all three; positions are spaced left/center/right on a
  deterministic sofa seat.
- Sofa seat, back, arms, floor, and two room-wall blockers are parametric cubes
  with explicit dimensions and labels.
- A wide 16:9 camera targets all three actors and the sofa; rule-of-thirds and
  safe-area guides remain available for composition review.
- The scene is a local white-model blockout. It is not a photoreal room, a
  generated asset, or a claim of physical seating/IK correctness.

## Preset B: 15-second fight blocking

- Two visible fighters use the existing white-model rig; the third actor is
  retained in the scene document but hidden to keep identity mappings stable.
- Timeline duration is exactly 15 seconds at the workbench FPS.
- Pose tracks use explicit blocking keys for guard, kick/throw, contact/recoil,
  recovery, and end pose. Character transform keys provide coarse spacing only.
- At least one contact/path event carries `exportMarker: true` so the event
  marker can be checked independently from pose interpolation.
- The camera uses a wide-to-medium coverage baseline. The result is a browser
  preview scaffold, not an exported animation video.

## Supplied-material validation plan

### Intake contract

1. User provides one local 15-second video file and confirms permission to
   process it. Do not collect credentials, cookies, or unrelated media.
2. Record file checksum, MIME type, duration, frame rate, dimensions, and audio
   presence. Reject or ask for clarification when duration/timecode is unknown.
3. Keep the original immutable. Derived frames receive their own checksum and
   source timestamp.

### Frame and blocking pass

1. Sample an initial review set at 2 fps (30 frames), then add event-adjacent
   frames around contact, recoil, recovery, and the final pose.
2. For each sampled frame, record visible actors, approximate screen anchors,
   facing direction, contact candidates, and occlusion notes.
3. Create or reset Preset B, then map only high-confidence phases to the white
   model. Preserve source timestamps on every keyframe.
4. Review camera coverage, foot contact, hand contact, depth ordering, and
   silhouette against the sampled frames. Mark unresolved items as manual
   review; do not silently interpolate through missing evidence.

### Optional render/reference pass

- **Current code fact:** the browser director can preview the keyed white-model
  timeline but has no approved video-render/export contract.
- A future render slice must define output codec, frame rate, camera source,
  watermark/metadata, and whether the result is an input reference for a model
  or only a human review artifact.
- Success for this V1 stops at a reproducible white-model preview and an
  evidence table; it does not include a generated MP4.

## Acceptance criteria

1. Preset A creates three visible seated actors, a labeled sofa/room blockout,
   and a wide camera without network calls.
2. Preset B creates a 15.00-second timeline with deterministic pose tracks,
   contact/export marker data, and no hidden fallback behavior.
3. Applying either preset is undoable and remains compatible with the local
   browser draft contract.
4. Existing director interactions (selection, pose editing, camera guides,
   timeline scrubbing, collapse/expand panels) continue to work.
5. Automated tests assert actor/object counts, duration, keyframe phases,
   marker export intent, and the absence of external requests.
6. Typecheck, UI tests, production build, and `git diff --check` pass.

## Boundaries

- No backend calls, model-provider calls, automatic pose estimation, or video
  export in this slice.
- No change to the director draft schema beyond serializing the already modeled
  authoring state.
- No assertion that a white-model preview is a production-ready animation.

## Affected paths

- `frontend/src/components/director3d/data/humanoid.ts`
- `frontend/src/components/director3d/state/workbench-store.ts`
- `frontend/src/components/director3d/scene/SceneTree.tsx`
- `frontend/src/components/director3d/scene/HumanoidStage.tsx`
- `frontend/src/components/director3d/DirectorWorkbench.test.tsx`
- `frontend/src/components/director3d/styles.css`
- `docs/specs/2026-09-23-director-validation-scenes-v1.md`
