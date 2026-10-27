# Character workbench: selection, cover and default reference

## Current product contract

Explicitly choosing a character thumbnail sets its category selection, character cover and default reference in one persisted mutation. The checkmark marks this cover/reference; it must not move merely because a newer result is appended or auto-previewed. There is no separate cover button. A failed selection restores the prior mark and exposes an error.

Default character reference indexes, derived images, motion references, display helpers and automatic storyboard references prefer the owned cover variant. Without an explicit cover they retain existing selection behavior. Explicitly selected shot images, confirmed episode uses and historical reference pins remain fixed. Cover selection does not create a reviewed front full-body asset-pack revision.

The workbench no longer fetches or displays project anchor revisions or episode-look confirmation forms. Existing reference records and dedicated APIs remain intact.

Explicit variant display names take priority. Otherwise the character name supplies `苏砚-1`; an unnamed character uses `项目.剧集.view N` with available series and episode titles. These are display fallbacks, not stored renames. Numbering continues across the visible still-image categories.

A yellow star means favorite. It can be toggled independently of cover and historical anchor records. Existing favorites are not migrated or cleared. Confirmed anchor deletion guards remain active; generation cleanup protects anchor and cover IDs separately from favorites. Shared asset mutations persist to their owning scope.

## Verification

Backend regressions cover selection-to-cover persistence, references across character categories, invalid selections, independent favorites, existing anchor protection, motion reference selection and storyboard defaults versus explicit shot picks.

Frontend regressions cover a single thumbnail action with no extra cover API call, a stable cover checkmark when new results arrive, rollback after failure, context naming, defaults across image categories and favorite error recovery. The generation lifecycle test also confirms a completed result replaces the generating state without unmounting the design.

Type checks, production builds and release health/version checks accompany deployment. No real user designs are changed for verification; browser acceptance remains separate from automated tests.
