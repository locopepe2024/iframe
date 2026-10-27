# Natural language director design — static slice

## Goal and boundaries

Users describe or revise blocking and static cameras in Chinese or other natural
language. A configured server-side LLM returns a typed intent proposal; pure
browser compilation computes pair placement, camera targeting and dolly movement.
No CLI, MCP, generated JavaScript/Python, asset generation or Blender process is
introduced. Existing authoring state owns truth; DirectorShotPackage is an export
projection. Reuse the existing LLMAdapter and existing owner identity context (including desktop browser profiles).

## First slice

- Existing actors/objects: absolute placement and yaw.
- Pair arrangement: two existing actors around a midpoint, separation, axis;
  calculate their facing in the existing +Y forward / Z-up coordinate system.
- Explicitly labelled box proxies for simple props, never confirmed assets.
- Static camera: subject IDs, azimuth/elevation, distance, physical focal length.
- Dolly current camera along its current target direction; preserve subjects,
  lens and authored target bindings. This is a static adjustment, not animation.
- Incremental requests receive current state, selection, prior conversation and
  full current camera settings; they do not replay earlier commands.
- Unsupported requests return a clarification, including timed camera motion,
  seating/poses, lighting, asset identity/appearance and scene generation.

## Contracts

POST /director3d/design-proposals accepts bounded context, prompt and a scene
revision token. Response uses a strict discriminated operation union, summary,
assumptions and clarification. Malformed output and provider failure fail clearly.
The server binds the response to the input revision; the model cannot choose it.
No arbitrary URLs, code or file paths are accepted as executable operations.

Browser validates output independently, resolves IDs and locks, rejects animated
scenes in this static slice (tracks/paths), nonidentity scene root, unsupported
calibration, out-of-range values and stale proposals. Model-proposed coordinates
are suggestions, not recovered measurements. Box dimensions and pair/camera
geometry are checked; near plane / in-frame subject checks are explicit.
Unsupported occlusion/contact/pose constraints are reported as unverified.

A proposal is compiled to cloned characters/objects/cameras. Preview supplies this
clone to the viewport without writing the store, changing selection or creating
undo entries. Editing or playback invalidates the preview and blocks apply.
A single store transaction revalidates and applies a plan, creating one undo
snapshot. Cancel restores the original view by removing the preview override.
Preview and recording are mutually exclusive. Exports are disabled while the
proposal viewport is active to avoid mixing candidate pixels with authored package.

## Success criteria and checks

1. Model intent -> compiler -> optional visual preview -> one atomic application.
2. Pair coordinates/facing and camera projection are deterministic and editable.
3. 'Only move the camera closer' preserves characters/objects/lens/target.
4. Scene changes, locks, active animation, invalid IDs/numbers and malformed model
   output never partially apply. Undo/redo restores the whole design.
5. Failed generation keeps authoring and the last reviewable proposal intact;
   closing/cancelling preview never changes authored state.
6. API tests mock model responses; compiler/store/UI tests verify real behavior.
   Run frontend focused tests, typecheck and backend proposal tests.
7. Live provider quality/latency, screen-space left/right, automatic occlusion
   correction and timed movement remain unverified/deferred. No quality claim.

## Affected paths

- src/apps/director_design.py; src/apps/comic_gen/api.py
- frontend/src/lib/directorDesign.ts
- frontend/src/components/director3d/design/*
- director3d state/workbench-store.ts, scene/HumanoidStage.tsx and App.tsx
- tests/test_director_design.py and focused frontend tests

## Reference evidence

Holodeck floor_objects.py separates LLM relation constraints from DFS placement.
MCP for Blender server.py exposes scene inspection, code execution and screenshots.
These are architectural references; their runtimes and scene owners are not used.


## Implemented verification / limits

- Backend uses the existing identity dependency and explicitly scopes/resets the
  LLM owner context; invalid identity is rejected. Desktop browser profiles retain
  existing project semantics. No new auth scheme is introduced.
- Candidate viewport overrides only render inputs; property edits and export
  entry points are hidden during preview. Timeline playback is suspended without
  unmounting the recorder, so existing recordings/results remain mounted.
- Frame checks currently verify subject centers, not full silhouettes or general
  visibility. Collision checks are conservative actor spacing and axis-aligned,
  unit-scale box proxies; imported mesh collisions remain unverified.
- Only the selected camera can be modified. Existing target bindings and focal
  length survive a dolly; a camera with no target must be framed first.
- UI/API tests use deterministic model stubs. Real provider understanding,
  latency and full WebGL visual acceptance have not been measured in this slice.

## Live provider acceptance (2026-10-21)

Add an opt-in check against an explicitly selected API origin and test-owner
session token. Use only a synthetic two-actor scene, not a saved user project.
The check must call the real proposal endpoint and pass its response through the
actual browser parser/compiler/store. Verify pair facing across a box table,
35mm two-subject framing, preview purity, atomic apply/undo/redo, stale rejection,
a follow-up camera-only half-meter dolly, and clarification for timed motion.
Record per-request duration and individual assertions; one passing run is a
runtime observation, not statistical evidence of general model quality. This
does not verify WebGL pixels, browser interactions, or production media depth.

The test is skipped unless explicitly enabled with an API origin. Missing owner
credentials fail before any request. Require HTTPS except for loopback HTTP,
disable redirects, and never log tokens or provider error bodies. Run with:

```bash
IFRAME_DIRECTOR_LIVE_URL=https://garage.uniart.fun \
npm run test:ui --prefix frontend -- --run src/components/director3d/design/design-provider.live.test.tsx
```

Supply `IFRAME_DIRECTOR_LIVE_TOKEN` through the operator's environment (never
commit it). This check consumes three model calls and modifies only an in-memory
frontend store; the API produces read-only proposals. No production config,
saved scene, merge or deployment is changed.

Live observation on iframe backend `0e41955474b0` using `gpt-5.6-sol`:
the first pair/table proposal returned HTTP 200 in 7946 ms, but assigned the
0.75m-high table a bottom Z of 0.375m. The compiler interprets box position as
bottom center, so this would float above ground. Explicitly document bottom
center and ground height in the model instruction. This is a prompt correction;
its effect on real-model output requires a new invocation with the corrected
instruction. The deployed endpoint still uses its deployed instruction.

Corrected candidate runtime observation: three real calls using iframe's
configured `gpt-5.6-sol` and `/opt/.iframe` credential passed the acceptance
check (10527 / 7099 / 6189 ms including SSH overhead). A temporary local API
loaded the corrected module; an ephemeral process in iframe's existing backend
container called its LLMAdapter with the candidate messages. No deployed source
or configuration changed. Synthetic identity was used on this candidate, so
this is not a production authentication/owner-configuration acceptance claim.
The earlier deployed-endpoint call did use a short-lived API-key session.
No keys or sessions were logged or committed. The test verified real response
compilation, grounded table, pair placement/facing, 35mm two-subject bindings,
preview purity, atomic apply/undo/redo, camera-only dolly, stale rejection and
timed-motion clarification. This single run is not a model reliability estimate.
Frontend focused checks: 10 passed; backend proposal checks: 15 passed;
typecheck passed. WebGL visuals and production media integration remain open.
