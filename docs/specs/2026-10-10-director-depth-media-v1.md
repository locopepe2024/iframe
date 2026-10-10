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
