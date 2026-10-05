# Character Workbench and Image Editor Boundary v1

## Observed

- Cast character entry and the asset library use the canonical `CharacterWorkbench`; Cast scene and prop entries use `CastWorkbenchModal`.
- `CharacterWorkbench` still contains historical generation controls, prompts, motion references, and accepted identity/look/continuity facets.
- The top-level image editor supports ordered image references, editable prompts, image generation, result review, and panorama candidates. A visual template library is not implemented.

## Decision

| Surface | Primary job | Output |
| --- | --- | --- |
| Director and shooting plan | Establish script, time, place, scene, beat and shot context | Context for downstream work |
| Character workbench | Resolve person, era and look; review identity and continuity across time and scenes | Confirmed character reference and continuity state |
| Image editor | Design appearance, gaze, expression, action pose, style, effects, scene and prop images with optional templates | Editable prompt and generated media candidates |
| Storyboard | Compose character, scene and prop references with action and camera instructions | Video-model submission |

Image editor templates may consume a selected character reference and projected scene or plan constraints. Each template fills an editable draft; the user chooses references, generation settings and whether to submit. A generated candidate stays separate from confirmed character identity and look until explicitly adopted. Scene media can go directly to Storyboard; adding it to a reusable library is an explicit action.

## Template contract for a later implementation

Each template has an ID, version, category, supported output mode, required reference roles, editable fields, and a prompt builder. Initial categories are character appearance, gaze/expression, action pose, style, effects, scene and prop. Template selection cannot silently change model, ratio, prompt references, Director data or character revisions. The generated candidate records template ID/version and chosen reference IDs so its source can be inspected.

## Current slice

Remove only the duplicate character Skill facet loader and panel from `CastWorkbenchModal`. Keep historical character data, canonical workbench controls, scene/prop modal behavior, Director analysis and shooting plan unchanged. No new template UI or storage is introduced in this slice.

## Assumptions and limits

- The current Cast route is the only production entry into `CastWorkbenchModal`; its character branch is legacy compatibility code. Route tests and call-site search verify this repository fact, not production runtime usage.
- Avatar service ownership remains as specified in `2026-10-03-digital-avatar-character-design-board-v1.md`; this cleanup does not claim an HTTP adapter exists.

## Success criteria and verification

1. Cast and asset-library character entry still mount the canonical workbench.
2. `CastWorkbenchModal` no longer loads or renders character facets; scene and prop behavior remains intact.
3. Focused UI tests, typecheck and production build pass.

Affected paths: the three specs above, `CastWorkbenchModal.tsx`, and focused UI tests. Run `npm run typecheck`, focused `npm run test:ui`, then `npm run build` from `frontend`.
