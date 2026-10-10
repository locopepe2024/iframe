# Recreation FFmpeg tests on media

## Observed

`tests/test_recreation.py` creates source clips via subprocess and recreation
analysis/assembly also invokes ffmpeg and ffprobe. Moving only the video fixture
would leave analysis and assembly dependent on the caller's binaries.
The media host provides both tools; GitHub-hosted CI does not share its filesystem.

## Decision and boundary

Run the entire recreation test module on an isolated `iframe-ci` user on media,
using a repository-specific self-hosted runner label `iframe-media-ffmpeg`.
The standard backend job excludes this module; it is not silently skipped by
binary detection. A separate job requires actual media binaries and runs all
recreation tests, including the existing timeout/mock tests.

No SSH command proxy, media URL change or runtime FFmpeg routing is introduced.
Both fixture and application subprocesses execute on media with normal local
paths and temporary test directories. Production data/services are not inputs.
The runner has no sudo rights. Fork pull requests do not run on this host.
Repository collaborators can run code as the dedicated runner user; this is an
explicit trust boundary. The media job is serialized and has a 20 minute limit.

## Acceptance

- Assert hostname/runtime identity and ffmpeg/ffprobe existence before tests.
- Run recreation tests on media against the exact PR commit.
- Record actual FFmpeg version and pytest result in GitHub Actions logs.
- Run remaining backend tests in the hosted runner.
- Merge through a PR after the media job passes; compare unrelated failing
  backend tests with main rather than masking them.
