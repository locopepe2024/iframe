# Shot reference workspace boundary reconciliation

## Authority

User clarification on 2026-10-15: character workbench may browse global reusable candidates; Storyboard and Shot Design show project/episode assets. Existing contracts distinguish membership from picker visibility:

- [Workspace index contract](2026-09-24-asset-material-workspace-index-v1.md), Effective Index Spaces: project-owned assets and explicit bindings, with permitted series inheritance, differ from the broader candidate index.
- [Scope and validity](2026-10-06-asset-scope-cover-validity-uniqueness-v1.md), Scope and Copy Rules: global availability does not create project membership; episode inheritance retains series ownership.
- [Cross-stage identity](2026-10-10-script-plan-asset-material-identity-v1.md), Scope and Reference Rules 1–4: series assets may appear with their existing IDs; global assets require explicit use/binding or placement.

These describe a target contract; they do not prove complete binding/revision support is implemented. This patch enforces the existing project/series membership boundary without introducing target placement records or claiming revision pinning.

## Observed

The current asset-index endpoint appends all owner-global assets after project and series records. The shot drawer uses that broad index, while video submission uses only project-response arrays. Project responses already omit unimported globals and include inherited series assets. An index-backed submission using the entire candidate pool would therefore expand the wrong scope.

## Scope and acceptance

Expose an explicit project-only index view, containing project/episode assets and inherited assets of its owning series, with local-over-series precedence. The default candidate index remains available to Character Workbench and import pickers. A global asset appears in shot design only after explicit import creates a project/series asset; preserve existing import identities and variants. No implicit import by name or URL.

Shot drawer, reference chips, editor resolution and both R2V submission paths use the project view. Defensively filter global entries in shot-specific projections. Refresh the current project index before video submission; refresh failure stops submission. Missing references are deduplicated and incomplete inputs cannot silently disappear. I2V keeps its chosen first frame. Storyboard project-array consumers retain the existing project response boundary.

Affected paths: backend index/API and tests; frontend API, shot reference helper, StoryboardR2V, AssetDrawer/AssetChipBar, bilingual error strings and focused CI coverage. No shared workbench candidate filtering, data migration, implicit bindings, provider or prompt/style changes, production deployment or paid model calls.

## Verification

Reproduce broad-index leakage and project/global same-name collision; test explicit project view excludes globals, includes inherited series, preserves local precedence and import behavior. Verify drawer/chips and submission cannot select an unimported global; imported project copies remain usable; selected variant refresh, authoritative empty/deleted entries, legacy compatibility and failed refresh. Run backend index/owner tests, frontend reference and workbench tests, typecheck/build and CI. Submit an independent PR based on merged #119 for administrator review; #120 remains separate.

## Main reconciliation — 2026-10-16

Main `60d6a909` already contains #109/#110 and #122–#127. This branch reapplies the project-index boundary from #121 to that actual baseline. Preserve legacy media migration and owner-specific output paths from #110; preserve adopted prompt/style edits and ordered saves from #124. Replace #109's prompt-name-based global inclusion in the shot editor with explicit project membership, including owning-series inheritance. Candidate/import workbenches retain their wider pool.

Resolved integration conflicts in the index signature, StoryboardR2V index state/reference submission, and CI steps. Keep all owner-poster and style-edit CI coverage alongside asset-scope coverage. Correct two pre-existing integration test assumptions: use the real asset resolver for refinement, and include the owner output directory in batch-render assertions. No runtime weakening or automatic import is introduced.

Review as the current-main replacement for #121; no force push or modification of that branch's unfinished local merge. No production deployment.
