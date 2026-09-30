# White model rig rest-pose review

Evidence file: `white-model-neutral-female-v1.rig-rest-evidence.json`

Source:

```text
white-model-neutral-female-v1.blend
SHA-256: 95eeb19c8abce2325479804b3dda429ebddfa6e8d07a2688541cc990fb676855
Blender: 4.5.9 LTS
Armature: white-model-neutral-female-armature
Bones: 73
Coordinate space: armature_local_rest
Quaternion order: xyzw
```

## Observed

Selected rest directions from the real rig:

| Bone | Rest direction |
|---|---|
| `pelvis` | `[0.0000, -0.2418, 0.9703]` |
| `spine_lower` | `[0.0000, -0.1160, 0.9932]` |
| `spine_mid` | `[0.0000, -0.0047, 1.0000]` |
| `spine_chest` | `[0.0000, 0.1963, 0.9805]` |
| `upper_leg_l/r` | `[0.0000, -0.0476, -0.9989]` |
| `lower_leg_l/r` | `[0.0000, 0.0948, -0.9955]` |
| `ankle_l/r` | `[0.0000, -0.9271, -0.3747]` |
| `foot_l/r` | `[0.0000, -0.9271, -0.3747]` |
| `toe_l/r` | `[0.0000, -1.0000, 0.0000]` |

## Direct implication

The browser candidate mapping is not calibrated to this rig:

- candidate upper leg rest direction `[0, -1, 0]` does not match the rig's near-vertical `[0, -0.0476, -0.9989]`;
- candidate foot rest direction `[0, 0, 1]` does not match the rig's `[0, -0.9271, -0.3747]`;
- the toe direction is a separate chain and must not reuse the foot direction blindly;
- pelvis and spine directions are distinct and must be calibrated independently.

## Required next step

Generate `director-rig-mapping.v2` from this evidence and record the rig SHA-256. Do not change the existing mapping revision in place. The first v2 preview should compare v1 candidate mapping and v2 calibrated mapping on the same motion track before enabling IK.

## Not yet proven

The exported armature-local directions alone do not prove the source video is in the same basis. A calibration pose or explicit source-to-armature basis transform is still required before applying these vectors to production animation.
