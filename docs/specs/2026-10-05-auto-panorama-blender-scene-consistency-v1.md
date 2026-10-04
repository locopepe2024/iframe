# Automatic panorama to Blender scene consistency v1

## Objective

Turn a generated environment into a controllable scene reference. The panorama is an environment layer and visual reference; Blender is the source of truth for subject placement, prop placement, depth, camera motion and multi-view consistency.

The system must not treat a single generated 2:1 image as a complete 3D scene.

## Evidence boundaries

- **Code fact:** the image editor can generate an equirectangular candidate, inspect image dimensions, and browse it in a 360 viewer.
- **Code fact:** the director already stores panorama calibration, scene-plate depth layers, characters, scene objects, camera paths and media-host Blender render requests.
- **Algorithm implication:** a panorama texture alone cannot provide metric depth, reliable occlusion or physically consistent parallax.
- **Not yet proven:** an AI-generated panorama has geometrically correct zenith, nadir, horizon or object scale merely because it is 2:1.
- **Required hypothesis:** depth and layout must be reviewed in Blender before a shot is admitted as scene-consistent.

## Pipeline

```text
scene brief + references
        |
        v
panorama candidate generation
        |
        v
seam / zenith / nadir quality gate
        |
        +--> failed: preview only, repair or regenerate
        |
        v
depth + horizon + semantic layout estimation
        |
        v
scene package for Blender
        |
        v
white-model actors + props + calibrated cameras
        |
        v
multi-view reprojection review
        |
        v
media host Blender render + full scene bundle
```

## Stage contracts

### 1. Panorama generation

Input:

- scene description and negative constraints;
- ordered reference images and their names;
- requested output dimensions, default `4096x2048`;
- generation mode `panorama_candidate`.

The prompt must require a complete sphere: continuous sky through the zenith, continuous ground through the nadir, no transparent or black holes, level horizon, seamless horizontal wrap, stable lighting and fixed scene scale.

Output:

- immutable owner-scoped image;
- `projection_type: equirectangular` only after explicit save;
- `panorama_quality` diagnostics;
- candidate status until depth and Blender review are complete.

### 2. Panorama quality gate

The gate checks:

- exact 2:1 dimensions;
- left/right seam discontinuity;
- transparent pixels in the top and bottom pole bands;
- black or empty pixels in the top and bottom pole bands;
- decode and checksum integrity.

Failure behavior:

- candidate remains viewable in the 360 viewer;
- candidate cannot be saved as an admitted panorama;
- director reports blocking codes and offers repair/regeneration;
- no automatic fallback to a perspective plane.

These checks detect image-level defects. They do not prove semantic correctness or metric depth.

### 3. Depth and layout package

The automatic estimator produces a versioned package, never mutating the original panorama:

```json
{
  "schema": "director-panorama-scene-package.v1",
  "panoramaInputId": "/playground/input-media/pano.png",
  "panoramaChecksum": "sha256",
  "coordinateSystem": "blender_x_right_y_depth_z_up",
  "horizonYNormalized": 0.5,
  "depth": {
    "inputId": "depth.exr",
    "nearM": 0.5,
    "farM": 80,
    "quality": "draft"
  },
  "semanticAnchors": [],
  "ground": { "heightM": 0, "quality": "draft" },
  "blockingCodes": []
}
```

Required anchor classes:

- ground plane and walkable regions;
- horizon and vanishing direction;
- major architecture boundaries;
- large props and entrances;
- subject placement hints;
- lighting direction and exposure reference.

The package must preserve source checksum and estimator version. A stale depth package cannot be applied to a different panorama.

### 4. Blender scene assembly on media host

Blender receives:

- the admitted panorama and scene package;
- white-model humanoid rigs;
- prop proxy meshes and semantic anchors;
- camera calibration and camera paths;
- reviewed motion bundle when available.

Blender builds:

- an inside-out panorama sphere for visual background;
- a depth-supported proxy shell or ground/architecture geometry;
- actor and prop placeholders at metric world positions;
- cameras that share one world coordinate system;
- optional shadow/contact catcher layers.

The panorama remains a background/reference texture. Proxy geometry controls parallax and occlusion; it must not be inferred from texture coordinates alone.

### 5. Multi-view consistency review

At least three cameras are rendered before scene admission:

- primary establishing camera;
- left/right or near/far alternate view;
- one camera with a small lateral translation.

Review must compare:

- actor feet against the ground plane;
- prop scale and occlusion order;
- horizon and vanishing direction;
- foreground/background separation;
- camera motion against proxy geometry.

If depth is draft or reprojection error exceeds the configured threshold, the scene remains `needs_director_review` and cannot be marked production-ready.

## Output contract

The media host render request extends the existing Blender contract with:

- `panoramaScenePackage`;
- `depthInput` and checksum;
- `proxySceneManifest`;
- `cameraSet`;
- `reviewStatus`;
- `blockingCodes`.

Outputs:

- `white_model_video.mp4`;
- `white_model_preview.png`;
- `multi_view_contact_sheet.png`;
- `scene_consistency_report.json`;
- `full_motion.bundle.json`;
- `director_scene_package.blend` or a reproducible Blender scene manifest.

## Admission states

| State | Meaning | Director placement | Blender render |
|---|---|---:|---:|
| `candidate` | Generated panorama only | preview | no |
| `panorama_verified` | Image gate passed | yes, background only | no |
| `depth_draft` | Depth package exists but is unreviewed | yes, proxy review | review only |
| `needs_director_review` | Camera/placement inconsistencies remain | editable | review only |
| `production_ready` | Multi-view review passed | yes | yes |

## Implementation order

1. Persist panorama quality and admission codes, already required by the image-editor gate.
2. Add `director-panorama-scene-package.v1` validation and owner/checksum binding.
3. Add depth estimator output import as a read-only calibration support layer.
4. Add Blender media-host scene assembly for panorama sphere, ground, proxy objects and white models.
5. Add three-view render review and reprojection error reporting.
6. Connect reviewed scene package and motion bundle to final Blender render/export.

## Acceptance criteria

- A 2:1 image with a sky, ground or seam gap cannot become an admitted panorama.
- A verified panorama can be assigned as a director background without changing actor or camera coordinates.
- Actors and props can be moved in metric coordinates and remain stable across all review cameras.
- A depth package with a mismatched panorama checksum is rejected.
- Draft depth never claims production readiness.
- Blender renders at least three views from one scene package and emits a machine-readable consistency report.
- The final package preserves panorama checksum, depth version, rig version, camera set and review status.
