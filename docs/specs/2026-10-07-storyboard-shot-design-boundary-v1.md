# Storyboard and Shot Design Boundary v1

**Status:** Accepted product boundary

The cross-stage identity and revision glossary is
`2026-10-10-script-plan-asset-material-identity-v1.md`. First/last frames and
Director snapshots are shot-scoped material by default; reuse as an asset
requires an explicit promotion or variant-confirmation decision.

## Canonical workflow

```text
Script / Director
    -> Assets
    -> Storyboard: scene reference design
    -> Shot Design: shot and video design
    -> Assembly
```

## Storyboard: scene reference design

Storyboard defines the visual reference package for a shot. It may contain:

- scene composition references;
- confirmed first frame;
- confirmed last frame;
- effects references;
- uploaded shot-scoped reference material;
- references to reusable character, prop, and scene assets.

Storyboard does not create the final video. Uploaded material is shot-scoped by default and is not silently promoted to a global asset. Promotion requires an explicit save-as-asset action.

## Assets: reusable material preparation

Assets owns reusable project, series, and global character, scene, and prop material. It is the source of stable asset identities, selected covers/variants, descriptions, and asset-level references. Storyboard may reference these assets without changing their definitions.

## Shot Design: shot and video design

Shot Design consumes the Storyboard reference package and defines execution:

- shot description, action, camera movement, and duration;
- generation mode and provider parameters;
- candidate generation and review;
- final take selection for Assembly.

The supported user-facing generation modes are:

| User label | Internal mode | Required inputs |
|---|---|---|
| Text to video | `t2v` | Prompt |
| Image to video | `i2v` | Confirmed Storyboard first frame |
| First and last frame | `first_last_frame` | Confirmed Storyboard first and last frames |
| Reference driven video | `r2v` | Storyboard reference images and/or reference video |

"All-in-one" may be used as a marketing label only. Persist the concrete internal mode.

## Migration boundary

- The temporary project's user-facing `Storyboard` surface becomes `Shot Design`.
- The series episode's user-facing `Motion` surface becomes `Shot Design` and adopts the temporary project's shot interaction model.
- The existing `storyboard` and `motion` API/data identifiers remain compatibility aliases until a data migration is explicitly approved.
- The existing unified workbench is not treated as the final boundary: its scene-reference controls and video-execution controls must be separated into the two surfaces above.

## Invariants

1. Storyboard changes can invalidate Shot Design, but Shot Design cannot rewrite Storyboard references implicitly.
2. I2V and first/last-frame mode can only use confirmed Storyboard frames.
3. R2V can use shot-scoped reference images or videos from Storyboard and reusable assets.
4. A Shot Design video task must record the Storyboard reference revision it consumed.
5. Assembly consumes a selected Shot Design take, never an unreviewed provider result.

## First implementation slice

1. Add explicit product labels and mode metadata without changing provider routing.
2. Extract the Storyboard reference package from the unified workbench state.
3. Reuse the existing shot interaction in the renamed Shot Design surface.
4. Add tests for mode input validation and Storyboard revision lineage.
