# Quaternius locomotion candidate review

## Observed

The author page https://quaternius.com/packs/universalanimationlibrary.html
was read on 2026-10-29. It labels the pack CC0 and distinguishes the free
Standard subset from Pro/Source editions. The official itch.io download could
not be reached in this session. Existing media-host files are the community
mirror inputs documented in `quaternius-standard-motion-review-2026-10-07.md`;
their provenance is not upgraded by reading the author page.

Media Blender 4.5.9 LTS ran the existing rotation-transfer diagnostic on the
SHA-matched pinned target blend. Source glTF SHA-256 remained
`0ff075c7ad6855c5c2c37a171592ee8f0d6ab2f58259e2be77a9b63dd8027765`.
All four actions evaluated, using 22 mapped bones. Report remains
`candidate_only`, with no contact acceptance or IK.

| Exact source action | Inclusive frame range | Target left/right foot-tail Z minimum (m) |
|---|---|---|
| Walk_Loop | 0–32 | 0.01570 / 0.01443 |
| Walk_Formal_Loop | 0–32 | 0.01927 / 0.01922 |
| Jog_Fwd_Loop | 0–22 | 0.16887 / 0.17658 |
| Sprint_Loop | 0–16 | 0.10098 / 0.10628 |

These are bone endpoint heights, not sole distances or contact verdicts. Source
jog minimum foot-tail heights were 0.00946 / 0.00557 m. The transfer holds target
pelvis translation at zero; the jog source pelvis endpoint displacement was
0.02303 m. Endpoint displacement alone does not establish locomotion mode/speed.

## Direct implication

Walk, formal walk, jog and sprint samples exist in the inspected Standard files.
The action list has no explicitly named small-step or stagger clip. Formal walk
must not be advertised as small-step. Jog and sprint cannot be promoted using
this rotation-only transfer: target foot baselines and pelvis translation still
need calibration. Walking minima alone do not prove support-foot locking.

## Next verification

Recover source pelvis translation and calibrated foot/ankle chain semantics;
measure full cycle displacement, sole geometry, support velocities and loop
seams. Render full-body and foot close-up sequences on media before promotion.
Keep licenseStatus at needs_verification and retargetStatus at unmapped.

The remote report is held at
`/tmp/iframe-quaternius-20261007/locomotion-diagnostic-20261029.json`;
the local temporary copy is `/private/tmp/director-locomotion-20261029.json`.
No production assets were modified. Probe now accepts exact action names via
`--actions`, retaining the original punch/sword defaults and failing for missing
actions. Python compilation and the four-action media run succeeded.
