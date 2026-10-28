# Editing workbench layout inspired by UniCut

Reference: locopepe2024/unicut at e0f2d47c51632f6d0024be25a33118c77f0f6766.
Source observations: Editor.tsx separates sources, canvas, properties and bottom timeline; panels collapse and resize. Toolbar.tsx groups split/delete and zoom above tracks. Runtime performance has not been verified.

## First buildable slice
- Upper area: collapsible material picker, preview, collapsible selected-clip inspector.
- Bottom: full-width timeline with a user-adjustable track height and existing zoom/ruler/filmstrips.
- Material directory CRUD remains in a separate tab. Switching tabs retains unsaved timeline state.
- Inspector owns trim/reorder/delete, selected gain, and selected subtitle text; remove duplicate inline editors from the tracks.
- On narrow screens use stacked areas, with optional panels collapsed initially.
- Preserve immutable material references, project revisions, export semantics, and source-only preview limitations.

## Verification
Existing AssemblyTracks and EditingPage behavior tests, typecheck, production frontend build. Add behavior coverage for collapsing/restoring optional panels and changing timeline height. GreenA acceptance with synthetic own media.

## Subsequent capability scope
Drag video clips to reorder, snapping with visible feedback, explicit keyboard editing commands, audio waveforms and synchronized audio preview each need separate behavior specs and validation before being claimed as supported. This slice does not introduce those capabilities or replace the renderer.
