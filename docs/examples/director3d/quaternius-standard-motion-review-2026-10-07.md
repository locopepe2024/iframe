# Quaternius Standard motion intake review (2026-10-07)

## Observed

- Author page: <https://quaternius.com/packs/universalanimationlibrary.html>. It labels the Universal Animation Library CC0 and lists FBX, GLB, and Blend formats. The Source edition includes the `.blend` rig and all animations; the free Standard edition is a subset.
- Inspected Standard mirror: <https://github.com/J-Ponzo/gltf-universal-animation-library>. Its README identifies a 2025-06-10 copy of the author's free Standard glTF edition, and its `LICENSE` contains CC0 1.0. This is a community mirror, not an author-hosted download.
- Local probe inputs, held only under `/private/tmp`:
  - `AnimationLibrary_Godot_Standard.gltf`: SHA-256 `0ff075c7ad6855c5c2c37a171592ee8f0d6ab2f58259e2be77a9b63dd8027765`.
  - `AnimationLibrary_Godot_Standard.bin`: SHA-256 `6e65377d81558333c4093dbb144a48fd19019343d82b1a3a7992a98ec0e0543c`.
- Blender 5.2.0 LTS imported the pair without saving a `.blend`: 53 source bones, 46 actions, and two meshes. `Punch_Jab` spans frames 0-20, `Punch_Cross` 0-24, and `Sword_Attack` 0-36. `A_TPose` is present.
- Source torso chain: `root -> DEF-hips -> DEF-spine.001 -> DEF-spine.002 -> DEF-spine.003`. Current browser white-model GLB (`d31319921ff0cc8600ccc2aa822a17503483f192a32dda2fc2a5f5ce61f111cf`) has `root -> pelvis -> spine_lower -> spine_mid -> spine_chest`.
- Candidate rest-direction differences measured from Blender-imported GLBs: hips/pelvis 0.5 degrees; lower spine 0.1; mid spine 2.5; chest 11.6; left upper arm 1.3; forearm 0.8; thigh 2.7; shin 4.0; source `DEF-foot.L` to target `foot_l` 63.9. These are direction comparisons, not pose-quality scores. The target foot has additional `ankle_l`, `foot_l`, and `DEF_foot_l` links.

## Direct implication

The free CC0 candidate contains usable strike and sword-action inputs. The existing white model has a lower-spine chain, so replacing it for a missing lumbar bone is not supported by this evidence. Its extra wrist and ankle/foot links require an explicit mapping policy. The foot direction mismatch blocks direct quaternion copying.

## Not yet proven

- The community mirror's individual files have not been compared with an author-hosted Standard archive. Keep production catalog `licenseStatus` at `needs_verification` until source-package provenance is recorded.
- No source-to-target parent-space rotation, rest-pose calibration, contact/IK, or rendered motion comparison has passed. Keep `retargetStatus: unmapped`; plugin selection or successful import cannot advance it.
- The pinned Blender rig rest evidence has SHA-256 `95eeb19c8abce2325479804b3dda429ebddfa6e8d07a2688541cc990fb676855` for its `.blend`. The browser GLB hash above is a different artifact identity; do not substitute it for the Blender rig hash in a mapping manifest.

## What would verify it

1. Obtain the author-hosted free Standard archive and record its license file, archive checksum, and animation-file checksums; compare the inspected glTF/BIN pair or repeat the probe on the official files.
2. Create a versioned candidate bone map against the pinned Blender `.blend`, including an explicit policy for source hand and foot bones versus target wrist and ankle helper chains.
3. Apply `A_TPose` and sampled frames from `Punch_Jab`, `Punch_Cross`, and `Sword_Attack` in Blender. Check evaluated parent-space bone directions and quaternion composition before enabling IK.
4. Measure root motion, foot-contact residuals, and pose continuity across each clip; render review frames and keep failure reasons. Only a reviewed result may advance to `validated`.

## Candidate transfer diagnostic

The versioned candidate map is `quaternius-standard-bone-map.v1.json`. `probe_quaternius_retarget.py` checked source and target SHA-256 before importing them in a fresh Blender 5.2.0 LTS background process. It evaluated all 21 `Punch_Jab`, 25 `Punch_Cross`, and 37 `Sword_Attack` frames and mapped 22 major bones. The report was written only to `/private/tmp/iframe-quaternius-retarget-diagnostic.v1.json` with `status: candidate_only`.

The largest evaluated source-to-target bone-direction error was 13.769 degrees at `neck`; `spine_chest` reached 9.4651 degrees, `foot_l` 8.7004 degrees, and `pelvis` 0.4665 degrees. The largest rotation residual against the solver's desired target rotation was below 0.07 degrees. That residual measures implementation consistency, not fidelity to a performer. `Sword_Attack` has a 122.0495-degree right-hand change at frame 10 on both source and target, so it is source motion evidence rather than a newly introduced target-only jump. Contact, IK, root travel, finger motion, sword grip, and rendered deformation were not checked. The target was the browser GLB, not the pinned Blender `.blend`; `retargetStatus` remains `unmapped`.
