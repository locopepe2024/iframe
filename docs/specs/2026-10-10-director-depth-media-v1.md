# Director depth execution on media

Core retains task identity, owner isolation, persisted status and output routes.
Configured `DIRECTOR_DEPTH_MEDIA_SSH_TARGET` selects remote execution explicitly;
there is no local fallback after remote failure. SSH uses batch mode and strict
host-key verification. Its user/key/known-host configuration is provisioned by
the operator, never supplied by the browser. The target runs Python 3 and
`DIRECTOR_DEPTH_MEDIA_BLENDER_BIN` (default `/opt/blender/blender`).

Each invocation sends only snapshot JSON and the pinned project render scripts
in a ZIP via stdin. The remote worker runs in a fresh temporary directory,
executes Blender without a shell, and returns only PNG, EXR and JSON via stdout.
Source code comes from the deployed Core revision, not a CI worktree. Remote
scratch is removed on completion/failure. Timeout terminates Blender remotely;
Core records failure without retry or fallback. Core validates returned file
names, size and manifest before exposing results through existing owner routes.

Acceptance: Blender 4.5.9 known-distance check, real remote API task output,
transport failure/invalid artifact tests, existing depth owner tests. Production
Core requires SSH connectivity and credentials; merging does not configure them.

## Production connection closure (2026-10-21)

Observed on iframe: the running backend has no DIRECTOR_DEPTH settings or SSH
mount; the host has no media alias/key. Media still has Blender 4.5.9 and the
previous CI account. This proves the current production connection is absent;
it does not establish that a historical production connection never existed.

Provision a separate `director-depth` media account without sudo, with an SSH
key restricted from PTY and forwarding. Keep the private key only on iframe in
`/srv/lumenx/runtime/director-depth-ssh` (0700), with config, pinned known_hosts
and id_ed25519 (0600). Pin media's public host key obtained over the existing
authenticated management connection, rather than accepting an unverified scan.

The release owner validates this fixed directory and mounts it read-only at
`/root/.ssh` only when DIRECTOR_DEPTH_MEDIA_SSH_TARGET is configured. Missing or
unsafe credentials must stop container creation before changing production.
Both candidate and production creation must retain the mount. Update both the
managed release env and the active container configuration. No SSH credentials
go into Git, output/media paths, image layers or browser responses.

Acceptance: reproduce release creation dropping the mount with a failing test;
verify read-only mounts, missing/private/symlink checks, and existing release
tests. Validate a disposable candidate with the same running image against media
before switching. Preserve the previous container and environment for rollback.
Submit a synthetic known-distance plane through the authenticated production
API, verify PNG/EXR/manifest, media hostname, Blender version, metric value and
package/snapshot checksums. Check capability and owner isolation. Do not invoke
local Blender. Source revision changes or active jobs block the runtime switch.

### Runtime observation

Production configuration cutover completed on iframe using the unchanged image
revision `5bd1f7222e69174ba8ff295551699d5985d7df66`. The isolated candidate,
production loopback API and `https://garage.uniart.fun` API each rendered the
synthetic 2m and 4m planes successfully on `VM-0-6-ubuntu`, Blender 4.5.9 LTS.
Normalized PNG center values reconstructed 2.0m/4.0m within 0.02m tolerance;
EXR magic, manifest unit/resolution and snapshot/package checksums passed.
Invalid sessions returned 401; another anonymous browser owner received 404 for
the authenticated owner's outputs through the public entry. Project/series IDs
were preserved and backend/static revision matched after the switch.

Public acceptance task IDs: `42fa6f8f678c4fa5ad0bc6e2c7b5ea5b` (2m),
`fb5f8703eb0b47c381e3d2486417aff8` (4m). These are synthetic artifacts under
the designated test owner, not user projects. This verifies API-to-media depth,
not full WebGL/UI acceptance or arbitrary scene accuracy. No local Blender ran.

Rollback container: `iframe-backend-before-media-20261021`. Environment and
startup-state backups plus cutover metadata are retained in
`/srv/lumenx/runtime/director-media-20261021`. The disposable candidate container
was removed. The tested release helper is preserved in that same directory;
the tracked release change must be merged before using the normal release entry
again, so a later deployment retains the SSH mount. Tests: 25 passed, explicit
remote integration test skipped, local Blender test excluded.

## Deployment configuration

Set `DIRECTOR_DEPTH_MEDIA_SSH_TARGET` to an operator-managed SSH alias or
`user@host`, and `DIRECTOR_DEPTH_MEDIA_BLENDER_BIN=/opt/blender/blender` in the
Core backend environment. Provision a dedicated non-root media account and a
private SSH key plus pinned `known_hosts` in the backend user's SSH directory.
For containers mount that directory read-only; the image installs openssh-client.
The worker needs Python 3, writable temporary space and Blender execution access.
No resident media HTTP service or deployed copy of the scripts is needed.

The public depth-capability endpoint probes remote Blender availability. Validate
one submitted frame after deployment; output manifest includes the actual media
hostname and checksum of the submitted snapshot. Configuration and a merged PR
do not constitute a production cutover observation.

## Verification

Media Blender 4.5.9 passed the two-frame 2/4 meter known-distance check under
`iframe-ci`. Local API-to-media SSH integration and failure/owner/configuration
and unsafe ZIP tests passed (8 tests). Test input contained only synthetic mesh
geometry. A media CI step repeats Blender metric and API tests on each revision.
