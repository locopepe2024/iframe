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

## Slice 2: video drag reorder
Native drag/drop moves a video clip before or after another clip according to the target midpoint. A visible insertion indicator shows the candidate boundary. Commit only on drop, so undo records one change. Source ranges and IDs remain unchanged, video remains contiguous, duration and other lanes stay anchored. Canceling drag makes no plan mutation. Existing move buttons remain the keyboard alternative. Foreign drags are ignored. Test direct arbitrary moves, no-op, and drop behavior.

## Keyboard scope
Shortcuts apply only to focused workbench surfaces (including the ruler), never
to unrelated page controls. Tab can focus the workbench. Preserve native keys
on inputs, buttons, links, media and rich-text descendants, browser modifier
combinations, IME composition and already handled events. Arrow keys seek in
100 ms steps; Space toggles preview; S splits at the playhead; Delete/Backspace
remove the selection. Repeated destructive commands are ignored. Verify outside
focus, native control behavior and modifier/composition guards with UI tests.

## Pointer edit transactions
Audio/subtitle movement and all edge trims use a local draft during pointer
movement, computed from the saved gesture-start plan. Release publishes at most
one change; cancellation, lost capture and no-op gestures publish none. If the
parent replaces the plan mid-gesture, discard the stale draft on release.
Video drag/drop ordering retains its existing single-commit behavior.
Verify audio movement/cancellation/no-op and video edge trim with full undo.
