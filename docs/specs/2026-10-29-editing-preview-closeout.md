# Editing preview closeout

Scope: finish pointer transactions, synchronized audio monitoring, real waveform
display and acceptance for the existing contiguous video editor. No transition,
layered video compositing or render queue change.

Preview maps the playhead into each enabled audio clip's source range. Overlapping
dialogue/music/effects play together, obey gain 0–2, mute, pause and seeking.
Source video audio obeys its clip gain too. Web Audio provides gain above unity;
unsupported/blocked playback must be visible. Stop and release players on project
change/unmount. Source metadata and decoding failures must not stop editing.
Preview monitoring is not an assertion of sample-exact parity with FFmpeg's final
limiter or subtitle typography.

Waveforms are real channel peak envelopes decoded locally on visibility, cropped
to the selected source interval. Bound fetch size (16 MiB), duration (5 minutes),
concurrency (one), cache (8 envelopes), abort fetches on unmount and show loading
or unavailable status. No decorative substitute. Long sources remain editable.

Verification: UI tests for overlap, source mapping, gain/mute, pause, transitions,
errors and cleanup; waveform crop/peaks/limits; pointer undo tests; existing
editing/compiler/subtitle regressions, typecheck and production build. GreenA
acceptance uses new synthetic assets/projects only, checks editing, save/reopen,
restore and MP4/SRT export, desktop/narrow layout and no client errors. Record
actual evidence and remaining limitations before declaring acceptance.
