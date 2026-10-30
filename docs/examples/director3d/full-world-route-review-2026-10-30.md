# Complete world route contract review

## Observed

89 focused route/contact/IK tests passed, including 24 new full-route tests.
The CLI test validates output input hashes and rejects a report lacking explicit
evaluationFPS without writing a result. No source/authored FPS is guessed.
Media Blender 4.5.9 LTS ran the pure validator on a synthetic 33-frame route:
0.01 m per frame at 24 FPS. It passed (0.24 m/s); removing its last sample failed.
The synthetic hashes used for that unit-level fixture are not real model evidence.
No character was rendered or moved by these checks.

## Direct implication

Full-frame route input can now be checked independently of per-foot support.
Support routes are checked against canonical slices instead of silently refitted.
Reports explicitly say routeApplied=false.

## Usage

Rerun probe_quaternius_retarget.py to produce a report with evaluationFPS.
Create director3d-world-route.v1 JSON per the spec. Every selected action must
have startFrame/endFrame exactly matching its report frameRange and one XYZ
translationsM entry per inclusive frame. Supply evidence and design_hypothesis
or manual_review provenance. Source/target SHA256 must match the report.

```sh
python3 scripts/director3d/prepare_world_route.py \
  --retarget-report retarget.json \
  --world-route world-route.json \
  --support-annotations support.json \
  --output validated-route.json
```

Support annotations are optional; when provided, their identities, ranges and
existing route offsets are checked. An old per-foot fitted route may fail, which
requires an explicit design edit rather than automatic replacement.

## Not yet proven

The output is an offline diagnostic artifact, not a production asset or rendered
trajectory. Apply canonical offsets once to the character, then measure evaluated
world-space foot trajectories and inspect full-cycle video in the next slice.
Heading, loop closure, terrain adaptation and no sliding remain unverified.
