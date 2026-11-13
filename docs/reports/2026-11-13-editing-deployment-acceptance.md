# Editing production acceptance — 2026-11-13

## Released revision

PR #336 is merged as `400e795643e0110149683dc61a912b805cad1b99`.
It includes main revision `8e5c7b09` and the editing reliability, library-image,
and timeline-thumbnail changes. Production previously served `95d77c85`.

The canonical `scripts/iframe_release.py prepare/deploy` flow was used on the
iFrame host. The isolated writable startup candidate passed before cutover.
Host checkout, backend image label, static manifest, and the public
`https://garage.uniart.fun/build-manifest.json` all reported `400e7956` after
cutover. Public `/health` returned HTTP 200. The prior backend, frontend, and
static directory were retained under the release script's rollback names.

## Live API and render observations

A fresh browser-profile cookie jar was held in memory for an isolated test
identity. Existing user projects, credentials and account settings were not
used. Four synthetic files were uploaded through the public editing API:
two videos, one portrait PNG, and one tone representing a narration track.

- Registered and imported all four sources into a new editing project.
- Saved a contiguous 2-second video / 3-second image / 2-second video plan,
  with an independently placed audio track and a selected burn-in caption lane.
- Reopened the saved plan and restored its saved revision successfully.
- Attempting to delete the image referenced by a saved version returned 409.
- Exported SRT with the requested text and exact 500–1500 ms cue interval.
- Rendered and downloaded MP4 through the owner-scoped signed output path.
- `ffprobe` observed both audio and video streams; the video stream was
  1280×720, 24 fps, and exactly 7.000 seconds long.
- Decoding the middle image interval verified the expected image color at the
  center and black at the edge, confirming equal-aspect letterboxing in export.

The new synthetic acceptance project is labeled
`Deployment acceptance 2026-11-13 400e7956`. The temporary client did not persist
cookies or credentials. No paid generation, voice clone or TTS call was made.

## Remaining evidence boundaries

This live API/render run does not prove browser canvas thumbnail decoding,
keyboard focus containment, browser Back/refresh handling, audio perception,
or small-screen layout. Those require the separately scoped browser acceptance.
Real TTS provider acceptance also remains separate from synthetic audio tests.

## Next closeout slice

Finish F3's modal focus, Escape, busy dismissal and focus-return behavior by
reusing the existing native editing dialog. Extend image regression coverage
to JPEG/WebP and animated-image rejection. Keep picture-in-picture, transitions,
configurable output formats, async render jobs, Agent and MCP in their later
roadmap phases; no completion claim is made for them here.
