# iFrame release drift and project store incident (2026-10-05)

## Observed

- Runtime observation: the server checkout and backend image both report `dad68735`. This only verifies the backend revision. The static frontend must be checked independently by inspecting its deployed artifact or manifest.
- Code fact: `feature/iframe-3d-director-v1` and `integration/iframe-director-current-20261004` diverge after `3f29717f`. The former has the deployed Director/3D path; the latter contains the character guidance tabs and scene asset creation path. Their isolated merge has 15 unresolved files and is not releasable.
- Code fact: `205711e9` introduced project rename and related management behavior, but Git ancestry places it on `deploy-series-director` and `feature/asset-director-context`, not either of the two current release branches. The integration list-row overflow button still has no action.
- Runtime observation: the earlier `0be08509` backend logged 45 project validation errors on `DirectorPlanScene.scene_asset_id`. Its old loader returned an empty project map on an exception. The previous release script tested OpenAPI only and did not read the mounted project store.
- Runtime observation: three episode IDs were in the original project store and remain referenced by the series record, but the current project store no longer contains them. The user has declined data restoration.

## Direct implication

This is a release-chain split across multiple features, not one missing UI button. A candidate revision can pass a build while omitting behavior from a different branch. A backend can pass OpenAPI startup while failing to load saved projects.

## Not yet proven

- The exact request or background operation that caused the old process to save the smaller `projects.json` is not identified.
- The static frontend revision has not been cryptographically tied to its source commit; matching backend Git and image labels alone does not establish browser bundle identity.

## Release boundary

1. Resolve the isolated merge, including project/series management from `205711e9`, without replacing the server tree wholesale. Build and test the actual merged source.
2. Before switching containers, run the candidate image against read-only mounted `projects.json` and `series.json`. Reject missing, malformed, or schema-incompatible records. Save timestamped copies of both stores.
3. During switch, block project and Agent write methods. After startup, validate both stores again and require unchanged record counts.
4. Build the frontend from the same reviewed commit. Record its revision in the deployed static artifact; verify the actual route bundle and required controls, not commit presence alone.
5. Report GitHub, server checkout, image label, and static artifact revisions separately. A mismatch blocks release.
