# Standalone material editing

Independent editing projects live under `/editing`, outside Studio Script,
Series, and Recreation projects. A library selection creates a reference to an
immutable owner-scoped media ID; it never edits the source project's timeline.
Uploads register managed media with a checksum and are visible in the editing
material library. Source rows expose origin, media ID and checksum. Generated
outputs are explicitly labeled, and adding them requires an explicit selection.

Plans reuse Assembly geometry and controls. The initial release supports a
contiguous ordered video sequence plus dialogue, music, effects and subtitle
lanes. Simultaneous layered video compositing is outside this slice. Source
trims remain at original speed. Each save/restore uses optimistic revision
checks and creates an immutable snapshot. Outputs record project revision and
are published only if it remains current. Media ownership, existence, checksum,
stream type and source duration are revalidated before rendering.

No provider calls, script analysis, or generated replacement is required.
The shared FFmpeg compiler normalizes video and mixes positioned audio, with
optional subtitle burn-in or SRT export. Rendering remains a synchronous bounded
operation, matching existing Assembly; persistent queue orchestration is future
work. Production activation is a separate step after review.

Acceptance: import two owner video materials without changing source projects;
upload a video and reopen it from the library; trim/split/reorder and add subtitle
and audio; save/reload/restore; render MP4 with matching duration. Reject foreign
media, changed bytes, source overrun and stale writes. Existing Studio Assembly
regression tests must continue passing.
