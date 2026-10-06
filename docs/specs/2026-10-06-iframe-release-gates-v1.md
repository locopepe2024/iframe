# iFrame release gates (2026-10-06)

## Observed

- The production service is `iframe-backend`, not `lumenx-backend`. Its output mount is `/srv/lumenx/output:/app/output`; the static frontend is served from `/srv/lumenx/chat-static` by `lumenx-frontend`.
- Before this release attempt, backend image and static manifest both reported `833706e550db14105531d0f45c9272c7a9e9edb0`. The server checkout and GitHub feature branch were advanced to `7b2c95980e62b756783bf4d51c465cd4664dd44c`, but production containers were not switched.
- The old `/srv/lumenx/deploy-3a13e4b.py` script hardcodes `lumenx-backend` and cannot deploy the current service. A copied script failed before any container switch.
- A candidate using the production data mount in read-only mode exited during startup: `extraction_jobs.recover_interrupted()` writes SQLite. A read-only mount is therefore not a valid startup compatibility test for this backend.
- A timestamped copy of `projects.json` and `series.json` was created at `/srv/lumenx/output/deployment-backups/20261006132123/`. The existing container reported 62 top-level project records and 10 top-level series records before the attempt. These are structural counts, not a full data integrity check.

## Release contract

1. Discover the actual service, image, mounts, network, port binding, static root, and current revision from `docker inspect` and the static `build-manifest.json`. Reject unknown or mismatched topology. Do not copy an old release script and substitute commit hashes.
2. Pin one reviewed Git commit. Confirm the GitHub branch, host checkout, backend image revision label, and frontend build manifest all equal that full commit ID. Build from a clean host checkout; do not include uncommitted local files.
3. Validate persisted project and series stores through the same model-loading path the candidate will use. Record counts and identifiers, and make timestamped copies without changing the originals. A failed load or missing identifier blocks deployment.
4. Run candidate startup against an isolated writable copy of the complete output tree required by startup, including SQLite files and their sidecars. The candidate must use a separate port and must not access the live writable output mount. Validate health, project/series loading, and the new preview endpoint's OpenAPI presence. Remove the candidate after validation.
5. Prepare a versioned static release directory and a backend image before changing production. The static directory must contain the exact commit in `build-manifest.json`; the image must carry the same revision label.
6. Switch the backend with an explicit rollback container and the inspected production env, mounts, network, and port bindings. Keep the old container intact until health and data checks pass. Then switch the static directory atomically and verify the live manifest. On any mismatch, restore both prior components.
7. After switch, compare persisted IDs/counts with the preflight snapshot and report GitHub, host checkout, backend image, and live static revisions separately. Do not claim a deployment when only Git or a build has advanced.

## Not yet proven

- The full set of writable startup paths has not been inventoried. The isolated-copy check must confirm it before a switch.
- The preview endpoint has passed local tests, but has not run against the host's object storage and real asset records.
- A current deployment script implementing the contract above does not exist yet. The old scripts are examples of past releases, not a safe entry point for this revision.
