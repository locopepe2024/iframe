# Character workbench: cover, naming, independent favorites

## Scope and behavior

The character workbench exposes a cover action and variant naming alongside the image strip. It no longer fetches or displays project anchor revisions or episode-look confirmation forms. Existing reference records and dedicated APIs remain intact. Setting a cover uses the existing compact cover endpoint and never creates or certifies a front full-body anchor.

Explicit variant display names take priority. Otherwise the character name supplies `苏砚-1`; an unnamed character uses `项目.剧集.view N` with available series and episode titles. These are display fallbacks, not stored renames. Numbering continues across the visible still-image categories.

A yellow star means favorite. It can be toggled independently of cover and historical anchor records. Anchor confirmation no longer forces favorites. Existing favorites are not migrated or cleared. Confirmed anchor deletion guards remain active; generation cleanup receives anchor and cover IDs separately from favorite state. Shared asset favorite mutations resolve and persist to their owner, and the favorite response retains the merged project view.

Cover success merges only the cover field into the latest character list without fetching a project. Cover and favorite requests expose pending and failure feedback. Names remain editable and explicitly saved.

## Verification

- Reproduced forced anchor favorites, missing reference-sheet fallback and inherited-series mutation failures in backend tests before the fix.
- Backend tests cover canceling an anchor favorite while retaining its cover/reference/deletion guard, series persistence, automatic retention and the existing cover API behavior.
- UI tests cover direct cover submission without anchor creation, context names, explicit names, favorite and cover error recovery, and the current-cover state.
- Related workbench, bridge and library inspector tests, TypeScript checks and the production build are required before publication.

Production user designs are not changed for verification. Browser interaction and real-user acceptance remain separate from automated tests and release health checks.
