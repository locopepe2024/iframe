# Director 3D scene depth v1

## Scope and evidence

User scope: support depth first; panorama processing is deferred.
Existing code normalizes Z depth per frame and replaces the scene camera.
This loses a fixed distance scale. Blender 5.2 runtime inspection confirms its
new `compositing_node_group` API; Blender 4.x uses `Scene.node_tree`.

## Contract and boundaries

Export existing `.blend` geometry using the active or explicitly named camera.
The optional existing motion bundle applies to one armature. Never save the
source file. Assume uniform scene units; convert using `scale_length`.

- Float32 EXR: camera-ray surface distance in meters; background is unmeasured.
- PNG: fixed near/far grayscale range across all frames, near black / far white.
  Treat pixel values as non-color data when reading them.
- Manifest: source checksum, Blender version, units, per-frame camera transform
  and projection, resolution, FPS, and actual output files.

No image reconstruction or scene accuracy claim. Browser task submission and
result ingestion remain a separate integration; panorama admission is irrelevant.

## Acceptance

Known geometry produces expected metric values at two distances, fixed PNG
scaling and unchanged source checksum. Missing cameras and invalid ranges fail.
Support a static scene without a motion bundle. Verify using headless Blender.

Affected paths: `scripts/director3d/render_depth_reference.py`,
`scripts/director3d/check_depth_reference.py`, this specification.

```sh
blender --background --python-exit-code 1 --python scripts/director3d/render_depth_reference.py -- \
  --source-blend scene.blend --output /tmp/director-depth --near-m 0.5 --far-m 20
blender --background --factory-startup --python-exit-code 1 \
  --python scripts/director3d/check_depth_reference.py
```

## Verification record

Blender 5.2.0 LTS headless integration check passed: a scene with unit scale 0.5
and surfaces at 4/8 scene units exported 2/4 meters. PNG samples matched 0.2/0.4
under a fixed 0-10 meter range. Camera identity and source checksum remained
unchanged. Invalid distance ranges and missing named cameras were rejected.
Blender 4.x compatibility code exists but has not been executed in this slice.
The new 5.2 file-output API appends the socket name to filenames; consumers must
use the manifest's actual filenames rather than construct a filename pattern.

## Browser submission slice

Submit one evaluated frame from the live Three stage: baked world-space mesh
vertices/triangles and active viewport camera matrix/projection, meter units.
Only explicitly marked scene geometry participates. Helpers and backgrounds
are excluded. This is a static-frame job, not an animation export.

Core owns `/director3d/depth-tasks` with existing identity dependency. Immutable
snapshots and task outputs persist under owner-hashed `output/users/*/director3d`.
No client-provided filesystem paths or scripts. A configured local
`DIRECTOR_DEPTH_BLENDER_BIN` (or `blender` on PATH) executes a project script with
a 120-second timeout, CPU rendering, serialized jobs and bounded geometry and
resolution. Missing runtime fails explicitly. Interrupted persisted tasks become
failed when read after restart. Downloads require the same owner.

UI provides near/far meters, submit, running/failure state, recovered recent jobs,
PNG preview and EXR/manifest download. The submitted camera/frame label stays
attached to each result. Polling stops on terminal state and unmount.

Success checks: owner isolation, request bounds, timeout/failure persistence,
real snapshot-to-Blender metric output, frontend submission/polling/failure,
typecheck/build and desktop/mobile visual checks when authorized.
