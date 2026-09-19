# White Model Neutral Female v1

This directory contains the first product-facing normalized humanoid admitted for the standalone 3D director workbench.
It is a real armature/skinned derivative rather than the procedural diagnostic figure used by the original Demo.

## Product identity

- asset ID: `white-model-neutral-female`
- asset version: `1.0.0-dev.2`
- normalized rig profile: `rig-director-humanoid-full-v1`
- rig profile version: `0.3.0`
- joint vocabulary: `director-humanoid-product-joints.v1`
- mapping version: `director-humanoid-product-joints.v1`
- joint-limit policy: `director-humanoid-joint-limits.v1`
- semantic-control policy: `director-humanoid-semantic-controls.v1`
- canonical evaluated height: approximately `1.7750504334 m`
- Blender baseline: `4.5.9 LTS`

The browser representation is
`browser/white-model-neutral-female-v1.glb`. The compiler-managed representation is
`blender/white-model-neutral-female-v1.blend`. `manifest/rig-profile.v1.json` is the shared product-facing joint
contract, and `manifest/validation.v1.json` records the pinned GLB re-import and deformation result.

## Source and provenance

The derivative was built from Quaternius' **Universal Base Characters — Standard** pack:

- product page: <https://quaternius.com/packs/universalbasecharacters.html>
- download page: <https://quaternius.itch.io/universal-base-characters>
- source file: `Superhero_Female_FullBody.gltf`
- source glTF SHA-256: `adedf28000a0716f689b009a70314506fc62f827498f77ba852acb5610f3f3f4`
- companion BIN SHA-256: `3a8220a485b33d05d879115a50697728b45a151781106033afb8b8c243fca208`
- downloaded Standard archive SHA-256: `fdbf1804c90dfc1ea03e992bff7da2dfd1a79318e13270a660180f9308455f40`
- bundled license-file SHA-256: `0f4beaf0fe360a7732e58bbe3dbf60a2422367fbea60cb9ea4add968f383268e`
- source license: CC0 1.0

The original 122 MB archive and source companion files are not stored in this repository. Exact source inspection and
admission evidence lives in the OpenSpec asset audit.

## Default appearance

The product-facing default is `sports_top_and_leggings.v1`: a dark opaque sports top and dark opaque sports leggings,
with neutral head, hands, and feet. It is intentionally non-nude.

This appearance is a deterministic material-region classification over polygons in the original skinned body mesh. It
is not cloth simulation and does not introduce separate garment geometry. Consequently, garment drape, collision,
layering, removal, and wardrobe editing are not supported by this asset version.

## Rig coverage and limitations

- 73 total bones
- 57 directly editable `product_joint` bones
- 4 derived `deformation_helper` bones
- 12 read-only `attachment` bones
- independent wrist/hand and ankle/foot controls
- complete admitted finger and toe controls
- all 57 product joints deform the exported GLB in the pinned validation

Every product joint now has a bounded range under `director-humanoid-joint-limits.v1`; only root yaw intentionally keeps
the full `-180..180` range. The versioned semantic-control policy derives 171 stable controls, one for every supported
axis of all 57 product joints. Each accepts a normalized `-1..1` value, maps `0` to the neutral rotation, maps negative
and positive values piecewise-linearly to the declared axis limits, and uses the pinned mirror sign policy `X=+1`,
`Y=-1`, `Z=-1`. These are conservative product editing bounds, not medical or biomechanical measurements. Sampled
browser/Blender deformation and pose parity remains a separate verification gate. The asset is not evidence of
anatomically safe IK behavior, cloth simulation, or contact-aware motion.

## Rebuild and validation

The derivative builder is `demo/director-reference/blender/build_product_humanoid.py`. It requires the exact admitted
source glTF and refuses a different source checksum. The repository does not download source bytes during builds.

The validation script is `demo/director-reference/blender/validate_product_humanoid.py`. It imports the final GLB in a
factory-startup Blender process, checks finite evaluated vertices, verifies that every declared product joint deforms
geometry, records bounds, and renders the thumbnail.

See `LICENSE.md` for redistribution terms and `manifest/build-audit.v1.json` for exact derived-output checksums.
