# iFrame release gates (2026-10-06)

## Observed

- The production service is `iframe-backend`, not `lumenx-backend`. Its output mount is `/srv/lumenx/output:/app/output`; the static frontend is served from `/srv/lumenx/chat-static` by `lumenx-frontend`.
- Before this release attempt, backend image and static manifest both reported `833706e550db14105531d0f45c9272c7a9e9edb0`. The server checkout and GitHub feature branch were advanced to `7b2c95980e62b756783bf4d51c465cd4664dd44c`, but production containers were not switched.
- The old `/srv/lumenx/deploy-3a13e4b.py` script hardcodes `lumenx-backend` and cannot deploy the current service. A copied script failed before any container switch.
- A candidate using the production data mount in read-only mode exited during startup: `extraction_jobs.recover_interrupted()` writes SQLite. A read-only mount is therefore not a valid startup compatibility test for this backend.
- A timestamped copy of `projects.json` and `series.json` was created at `/srv/lumenx/output/deployment-backups/20261006132123/`. The existing container reported 62 top-level project records and 10 top-level series records before the attempt. These are structural counts, not a full data integrity check.

## Release contract

1. Discover the actual service, image, mounts, network, port binding, static root, and current revision from `docker inspect` and the static `build-manifest.json`. Reject unknown or mismatched topology. Do not copy an old release script and substitute commit hashes.
2. Pin one reviewed Git commit. Confirm the GitHub branch, host checkout, backend image revision label, and frontend build manifest all equal that full commit ID. Perform the GitHub SSH lookup as the checkout owner (`ubuntu` on this host), whose trusted-host configuration is available; root handles only privileged service and data operations. Build from a clean host checkout; do not include uncommitted local files.
3. Validate persisted project and series stores through the same model-loading path the candidate will use. Record counts and identifiers, and make timestamped copies without changing the originals. A failed load or missing identifier blocks deployment.
4. Run candidate startup against an isolated writable copy of the durable top-level state required by startup: project, series and global library JSON plus SQLite files and sidecars. Exclude the large `users/` media tree. The candidate must use a separate port and must not access the live writable output mount. Validate health, project/series loading, and the new preview endpoint's OpenAPI presence. Remove the candidate after validation.
5. Prepare a versioned static release directory and a backend image before changing production. The static directory must contain the exact commit in `build-manifest.json`; the image must carry the same revision label.
6. Switch the backend with an explicit rollback container and the host's ignored `/srv/lumenx/repo/.env`, inspected mounts, network, and port bindings. Require the environment file to exist with private permissions; never reconstruct it from an old container. Keep the old container intact until health and data checks pass. After switching the static directory, recreate the stopped frontend container from its inspected nginx configuration and port binding so its bind mount targets the new directory inode. Verify both the static file and the HTTP-served manifest report the new revision. On any mismatch, restore both prior containers and the prior static directory.
7. After switch, compare persisted IDs/counts with the preflight snapshot and report GitHub, host checkout, backend image, and live static revisions separately. Do not claim a deployment when only Git or a build has advanced.

## Not yet proven

- The isolated candidate checks startup and state compatibility. It does not validate access to media under `output/users/`; a production smoke test must cover the new preview route after the switch.
- The preview endpoint has passed local tests, but has not run against the host's object storage and real asset records.
- The canonical deployment entry is `scripts/iframe_release.py`. `scripts/deploy_server_release.py` is retired and exits without changing containers or nginx.

## Canonical commands

```bash
python3 scripts/iframe_release.py inspect
sudo python3 scripts/iframe_release.py prepare --revision <full-40-character-sha>
sudo python3 scripts/iframe_release.py deploy --revision <full-40-character-sha>
```

`prepare` and `deploy` require root because the service account cannot safely snapshot the owner-scoped output store. They require the exact feature branch and exact GitHub branch revision; no implicit HEAD, branch merge, or old deployment script is accepted.
