# Compact independent-editing header

## Evidence and scope

- The existing page repeats the project title and keeps a description, creation form, project actions and history on separate rows above the workbench.
- The November 2 GreenA session reviewed `locopepe2024/ai-video-editor`, a fork of `MartinDelophy/ai-video-editor`, for clip duplication, source captions and voice workflows.
- The current reference is `MartinDelophy/ai-video-editor` at `0fff757157cd7d8745f3f45c1ab6cb1773f98c5c`, `src/components/Topbar.jsx`: project identity and status are grouped on the left, file actions use a dropdown, project naming uses a dialog, and export is on the right. These are source observations; the reference application was not run.

## Interaction contract

- One desktop header groups Editing/Materials navigation, project selection, revision/unsaved status, creation, save, voiceover and MP4 render. Narrow layouts wrap into explicit navigation and project/action rows without horizontal page overflow.
- The project title appears only in its selector. The workflow description appears only when no project is selected.
- New-project naming opens a modal with a visible label, cancel/close, Enter submission, inline errors and retry. Creating is disabled while busy or dirty.
- A project-actions disclosure contains reload/discard, version history and delete. It supports native Tab navigation, Escape, outside dismissal and focus return. Deletion retains its confirmation.
- History opens a modal, including empty/loading/error states; restoring retains optimistic revisions and closes only after success. It never adds a persistent workbench row.
- Keep manual save, dirty gates, revision-bound render/download, project/source ownership, timeline controls and materials-tab draft retention unchanged. No rename or autosave is introduced.

## Verification

Affected paths: EditingPage, small editing UI primitives and EditingPage interaction tests. Run EditingPage and AssemblyTracks UI tests, frontend typecheck and production build. Cover new-project cancel/create/error/retry, dirty gates, disclosure dismissal/focus, history restore and unchanged save/render semantics. Browser MCP inspection remains subject to the parent AGENTS permission requirement.
