# Media FFmpeg CI

## Scope

`media_ffmpeg` marks tests that invoke real `ffmpeg` or `ffprobe`. The
GitHub-hosted `backend-tests` job runs the remaining tests on pull requests and
on `main`. The `media-ffmpeg-tests` job runs marked tests on the media host
only after a push to `main`, or a manual dispatch from `main`.

The media job is a post-merge check. It is not a pull-request gate. A failing
non-media test still fails the `backend-tests` PR check.

## Runner Boundary

Register a repository-scoped GitHub Actions runner on the media host with the
custom label `iframe-media`. Run it as a dedicated, unprivileged system user
with a private home and workspace. Do not grant the runner sudo, production
environment files, SSH keys, or access to application output directories.
Never let pull-request events run code on this host. Keep the workflow job's
`main` ref condition when changing triggers.

The runner needs Python 3 with `venv`, network access for Python packages,
and the media host's existing `ffmpeg` and `ffprobe` on `PATH`. The job builds
its own `.venv-ci` in the checkout. It uses generated test media and temporary
files; it does not require a production data mount or API credentials.

After runner registration, dispatch `Backend CI` on `main` and verify that
`media-ffmpeg-tests` reaches the `Run real media tests` step. A queued job or a
local test run does not establish that the host integration works.
