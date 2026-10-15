# Assembly source audio reconciliation

## Observed

The deployed renderer retains audio, while main at `41953a0e` still concatenates video only (`a=0`, `-an`). A real FFmpeg regression test creates red/tone, green/silent and blue/tone segments; main produces a three-second video without an audio stream. This is direct runtime reproduction, independent of earlier production observations.

## Scope and acceptance

Port the reviewed audio portion of the production renderer only. Preserve source audio by default, apply the existing video clip gain (zero mutes), match source trims and any already-supported retiming, normalize to stereo/48 kHz, pad short or absent audio, and concatenate into AAC alongside H.264. Use the FFmpeg executable's sibling ffprobe (including `.exe` on Windows). Probe failures must report a source-audio error rather than silently treating unreadable audio as silence.

Do not add dialogue/BGM/SFX lanes, change video geometry, select different takes, move ownership boundaries or change provider/storage routing. Separate audio lanes remain explicitly unsupported. Original source files remain unchanged. New UI audio replacement and swimming-lane editing stay in a later slice.

Validate real mixed sound/silence/sound output, gain/mute, trim and retiming, plus plan/compiler/selection tests. Check both project and series paths and revision safeguards. No billable model calls or local Go commands. The existing production renderer stays running; this PR is for administrator review and merge, not a production replacement.

CI follow-up: validate all managed sources before discovering FFmpeg, so missing local dependencies do not mask invalid source references. Hosted CI reproduced that ordering bug; the regression explicitly removes FFmpeg. Real Assembly audio tests now also run in the existing media-host job, since hosted workers may lack FFmpeg.
