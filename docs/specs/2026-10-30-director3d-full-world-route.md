# Complete world route input (offline diagnostic)

Problem: per-foot support annotations leave unobserved action frames and do not
provide a full character trajectory. Fitting each foot independently is not a
solution to this missing input.

This slice introduces director3d-world-route.v1: source/target SHA256, evaluation
FPS, provenance/evidence and one inclusive XYZ metre translation array per action.
Each action must exactly cover its declared action range; duplicate, missing or
unknown actions, mismatched FPS/identity, malformed samples and excess speed fail.
No interpolation or fitting is performed. Input is a design hypothesis, not
recovered ground truth. Coordinates are world XYZ additive offsets to the
unrouted retarget; ground convention remains Z=0. No heading is implied.

Existing support routes must equal slices of this canonical route within 0.1 mm.
A mismatch fails instead of replacing user input. The CLI accepts the existing
retarget report as the action/FPS/identity contract, a route JSON and optionally
support annotations. It outputs route validation and resolved interval slices.
The retarget report must record evaluationFPS; authored/source FPS stays unverified.
No renderer, skeleton, production catalog, asset store or UI is modified by this
slice. Applying offsets exactly once in rendering and checking evaluated geometry
is the next integration boundary.

Success: exact full coverage passes; missing end frames, mismatched identity/FPS,
NaN, duplicate actions, high speed and conflicting support slices fail. Unit tests
and a media Blender Python positive/negative check verify the pure validator.
Affected paths: scripts/director3d/world_route.py, prepare_world_route.py,
probe_quaternius_retarget.py report metadata and focused tests.
