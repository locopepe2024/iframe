# Version consolidation checkpoint — 2026-10-16

## Scope and evidence

User priority: finish version/configuration consolidation. Voice-library
expansion (including Edge TTS), timeline editing and composition feature
improvements are deferred. Existing source-audio preservation stays part of the
reviewed baseline; no new rendering feature is included in this checkpoint.

GitHub observations at this checkpoint: #138, #139 and #140 are merged with
all three CI checks successful. Current pipeline slice is based on main
fd72a478. Do not merge directly as the agent.

The Edge TTS worktree contains no implementation changes. Public documentation
was researched; it has not been added to the product or dependencies.

## Completed review slices

- Independent provider profiles, GreenA naming, selected catalog metadata and
  diagnostic labels have been submitted/merged in preceding slices.
- Root/locator foundation, owner storage/signing and cloud-upload root arguments
  are merged (#133, #136, #137).
- Image/video writer roots and legacy alias resolution are merged (#138).
- Audio initialization repair and audio/storyboard writer roots are merged (#139).
- Playground preview renewal, upload indexing, first-input reads and archiving
  root propagation are merged (#140).
- Pipeline persistence, reference/registry, migration and existing assembly paths
  now carry the instance root in the current review slice. Local backend CI
  selection passed 1357 tests after integration with current main; affected
  source-local index/owner migration plus new root tests passed 17 tests.

## Remaining consolidation work

1. Administrator review of the pipeline root propagation slice; no rendering
   behavior or editing feature change is included.
2. Remaining HTTP factories/routes, asset-library readers, thumbnails, downloads,
   registry consumers, recovery and provider-internal media publication. Recheck
   ownership, range responses and alias compatibility before a global switch.
3. Administrator root selection and explicit Local/COS/OSS backend selection.
   Currently root arguments are dependency-injection APIs, not an enabled
   application-wide setting. Backend readiness and retained locators must work
   across configuration changes; credentials must not silently select storage.
4. Reconcile reviewed production-specific changes and external deployment
   profiles; add revision/image-pinned releases and rollback verification.
   Earlier local/remote source comparisons are historical evidence only, not a
   fresh claim that production matches current main or running image contents.

Old open PRs #18, #47–#49, #51, #53, #56, #57, #59 and #63 were observed during
the audit. They cover other feature/integration branches or CI infrastructure;
this work has not established that they should be merged, closed or copied into
this configuration release. Keep them separate until their owner/dependencies
are reviewed. Preserve dirty local trees and the unfinished #121 worktree.

## Release boundary

No production deployment in this checkpoint. Do not copy main wholesale over
malysis or claim all local/remote versions match. New PRs remain subject to
administrator review. No local Go execution or paid model calls.
