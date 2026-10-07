# Director 3D Quaternius retarget diagnostic v1

## Scope and assumptions

Use the CC0 Universal Animation Library Standard glTF pair as a local source and the current browser white-model GLB as a diagnostic target. The pinned Blender `.blend` associated with `director-rig-rest-evidence.v1` is not present in this checkout. A GLB-based result must identify the GLB checksum and cannot satisfy the `.blend` rig admission gate.

## Inputs and boundaries

- Explicit versioned bone map; no name guessing at runtime.
- SHA-256 checks for source glTF, companion BIN, target GLB, and mapping.
- Blender 5.2 action/slot evaluation at selected frames of `Punch_Jab`, `Punch_Cross`, and `Sword_Attack`.
- Transfer each source bone's rotation from its rest frame into the target bone's rest frame, solving the target pose quaternion through its evaluated parent pose. Reset target channels for each source frame.
- Report coverage, non-finite values, source motion from rest, source and target adjacent-frame changes, angular residual of transferred rotations, and actual source-to-target evaluated bone-direction error. Quaternion metrics use the minimum angle, treating `q` and `-q` as the same rotation. Treat these as algorithm diagnostics, not motion-quality approval.
- Root travel, foot contact, IK, hand grips, sword prop interaction, and rendered appearance remain unvalidated. Do not write to source files or mark `retargetStatus: validated`.

## Success criteria

1. The map names existing source and target bones and has no duplicate target entries.
2. Each selected action has evaluable animation frames, and the diagnostic emits source and target SHA-256, mapping revision, Blender version, sampled frames, and stable warnings.
3. Pose rotation values are finite; angular residual and continuity metrics are reported by bone, including pelvis, spine, legs, feet, and arms.
4. A failed input or missing action aborts instead of emitting a passing result.

## Affected paths and verification

- `docs/examples/director3d/quaternius-standard-bone-map.v1.json`
- `scripts/director3d/probe_quaternius_retarget.py`
- `docs/examples/director3d/quaternius-standard-motion-review-2026-10-07.md`

Verify with `python3 -m py_compile scripts/director3d/probe_quaternius_retarget.py` and a Blender background run using the pinned local glTF/BIN and target GLB. Review the diagnostic report without promoting catalog status.
