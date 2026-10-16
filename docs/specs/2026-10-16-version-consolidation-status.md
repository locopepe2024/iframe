# Version consolidation checkpoint — 2026-10-16

## Scope and evidence

User priority: finish version/configuration consolidation. Voice-library
expansion (including Edge TTS), timeline editing and composition feature
improvements are deferred. Existing source-audio preservation stays part of the
reviewed baseline; no new rendering feature is included in this checkpoint.

GitHub observations: #141, #142 and #143 are merged; main is
afe4844b. #144 remains open at cccff018 with all three CI checks successful
at this audit. The remaining-media-consumer slice is based on afe4844b.
Administrator review and merge remain required.

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

1. Administrator review of #144: explicit backend upload gates and restart-only
   storage settings. Its latest observed three CI checks passed.
2. Review the remaining media-consumer slice: Agent database/references,
   Recreation database/files/signing, asset preview, polish references and
   voice-preview cache now carry the selected root. Backend CI selection passed
   1384 tests (5 skipped, 2 deselected); Agent/Recreation/root-specific selection
   passed 114 tests (1 skipped), including real FFmpeg fixtures.
3. Deployment alignment remains outstanding. Read-only malysis observations:
   frontend/backend container image tags are 99d47bfb; backend bind mounts are
   /srv/iframe-nsfw/output to /app/output and /srv/iframe-nsfw/home to
   /root/.iframe. Source directory /srv/iframe-nsfw/source has no Git metadata.
   Tags alone do not prove image source contents. Production has not been
   deployed or verified against afe4844b by this slice.
4. Reconcile production-specific changes before a revision-pinned build/deploy;
   retain configuration and media mounts and record rollback image IDs. Verify
   expired COS URL renewal and WebP covers in production after deployment.
   The existing release helper targets lumenx topology, not malysis; do not
   execute it unchanged on malysis.

Old open PRs #18, #47–#49, #51, #53, #56, #57, #59 and #63 were observed during
the audit. They cover other feature/integration branches or CI infrastructure;
this work has not established that they should be merged, closed or copied into
this configuration release. Keep them separate until their owner/dependencies
are reviewed. Preserve dirty local trees and the unfinished #121 worktree.

## Release boundary

No production deployment in this checkpoint. Do not copy main wholesale over
malysis or claim all local/remote versions match. New PRs remain subject to
administrator review. No local Go execution or paid model calls.
