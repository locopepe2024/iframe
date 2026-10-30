# Complete world-route application review

## Observed

Media Blender 4.5.9 LTS evaluated the SHA-bound female white model and Quaternius
Walk_Loop over 33 inclusive frames (0..32), at 24 evaluation FPS. Five runs:
baseline, full-route retarget, single-support virtual-route IK, single-support
full-route IK, and alternating-support full-route IK. The last rendered 66 PNGs
(full body and feet) and a 1.375-second side-by-side MP4. This is one diagnostic
cycle, not the requested eventual 4–6 second scene reference.

Comparing every reported target point and every evaluated sole vertex against
baseline plus the requested world offset gave max residual 0.0000103455 m, both
without and with single-support IK. Source points were unchanged. Contact drift
and speed metrics matched the virtual-route reference within 0.1 mm/0.1 mm/s.
This verifies one-time route application on this fixture, including unsupported
frames. It does not certify arbitrary rigs or authored movement.

Both full-route IK support intervals still report supportAccepted=false. Endpoint
sole residuals reach 0.01018 m and 0.00964 m. The inspected frame 16 still shows a
lifted foot; it cannot establish full-cycle visual quality or no sliding.

The first simple 0.01m/frame straight-route trial failed with the existing
requested support offset exceeds 0.05 m gate. The gate was retained. The successful
fixture explicitly reuses fitted support segments, shifts the second to connect
to a linear bridge and extends the tail. This is a numerical design hypothesis,
not a recovered or natural gait; provenance is preserved in route.json.

100 local route/contact/IK/comparison tests passed. The comparison regression
also rejects double offsets, moved source geometry, missing vertices and NaN.

## Direct implication

The offline probe now applies complete routes to evaluated geometry after IK and
before measurement/rendering. Contact metrics use zero additional offset once the
geometry has moved. Existing support-only behavior is unchanged. Full-route
validation covers gaps between support windows instead of bypassing coverage.

## Artifacts and reproduction

Persistent artifacts: director3d/reviews/world-route-20261030/ contains route.json,
support.json, comparison.json, world-route-review.mp4 and frame 0016.png.
Media inputs remain under /tmp/director-world-playback-20261030/. Run
scripts/director3d/check_world_route_playback.py --help for the five-run harness.
The probe accepts --world-route with the existing source/target/mapping flags;
--sequence-dir renders every frame. Each action resets to the captured hierarchy
baseline; world translations never accumulate between frames or actions.

## Not yet proven

No contact acceptance, no-sliding guarantee, loop closure, heading, terrain
adaptation, arbitrary-model support or production playback promotion. No asset
library integration or deployment is included. Next: author a physically plausible
full route and support timing, then inspect contact patches through transitions.
