# Editing production acceptance — 2026-11-13

## Current released revision

PR #337 is merged as `7efe69c8e14641019df00a4b04c4491213637f51` and deployed.
The tested head `4b63883f` and the merge commit have identical trees. All three
PR checks passed in run `43410276397`; all three post-merge checks also passed
in run `43410725475`.

The same canonical release process passed its isolated writable candidate
before cutover. Host source, backend image label, static manifest and the
public manifest all match `7efe69c8`; public `/health` returned HTTP 200.
The `400e7956` backend/frontend and static tree remain available as
`iframe-backend-before-7efe69c8e146`, `lumenx-frontend-before-7efe69c8e146`
and `/srv/lumenx/iframe-static-releases/before-7efe69c8e146`.

## First release in this closeout

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

## Follow-up runtime acceptance at 7efe69c8

A second new isolated browser-profile identity repeated the upload, save,
reopen, restore, source-deletion protection, SRT, render and signed-download
checks. The synthetic project is labeled
`Final deployment acceptance 2026-11-13 7efe69c8`.

- The actual video stream is again 1280×720, 24 fps and 7.000 seconds.
- The 2-second video / 3-second portrait image / 2-second video arrangement
  preserves the expected image center and black letterboxing.
- An SRT cue from 2500 to 4500 ms matches the requested time and text.
- Comparing image-interval frames with the caption off and on finds visible
  burned-caption pixels in the lower frame, at bounds `(392, 603, 891, 664)`.
  This verifies actual rendered pixels, separately from selecting a burn lane.
- The independent audio clip uses source 500–5500 ms and timeline
  1000–6000 ms. Decoded audio RMS is 0 at 0.25 and 6.5 seconds, and about
  0.093 at 1.5 and 5.5 seconds. This verifies signal placement in the exported
  file; it is not an assertion of human listening acceptance.
- Cookies remained in memory and were not persisted. Existing user projects
  and paid generation services were not used.

## Closed implementation slice and remaining scope

F3's leave, voiceover and transcription dialogs now reuse the existing native
editing dialog, including initial focus, Escape, busy dismissal and focus
return. The voice picker closes before its parent on Escape. Component tests
cover these behaviors; actual browser focus containment remains unverified.

Still-image save/restore and real-FFmpeg regression coverage includes PNG,
JPEG and WebP; animated PNG/WebP rejection checks avoid material registration
and leftover uploaded files. The public deployment smoke used PNG.

Local targeted checks: EditingPage 39 passed; AssemblyTracks/TimelineFilmstrip
25 passed; standalone editing/compiler 52 passed, 2 skipped for unavailable
local libass. Typecheck and production build passed sequentially. Media CI
also passed on the FFmpeg host. No full unrelated UI-suite pass is claimed.

The code slice comprising F1/F2 editing reliability, F3 navigation/modal
behavior, F4 voiceover preview/placement, library still images and interval
thumbnails is merged and deployed. Browser Back/refresh, interval-thumbnail
visuals, desktop/narrow layout, audio listening and real TTS remain separate
acceptance items. The repository-required browser permission request is still
unanswered; browser automation was not run.

This does not close the whole editing roadmap. Explicit picture insert versus
replace, fill/crop mode, automatic audio ducking, output format controls,
interval renders and persistent asynchronous jobs remain later P0/P1 work.
Picture-in-picture, transitions, keyframes, Agent, voice input and MCP retain
their later phases. External internet URL import is outside the agreed scope;
media continues through uploads to the material library.
