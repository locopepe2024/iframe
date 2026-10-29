# Quaternius evaluated sole geometry review

## Observed

Media Blender 4.5.9 evaluated all 106 inclusive samples of the same four
locomotion clips with pelvis displacement enabled. Each side selected 197
fixed vertices from the weighted foot/toe region's rest bottom 2 cm band.
Ground is the design plane Z=0. This selection approximates sole geometry.
Pinned inputs and machine-readable summaries are in
`quaternius-sole-summary-2026-10-29.json`.

| Clip | Lowest left/right selected vertex (m) | Frames below -1 cm, left/right | Frames with any vertex in [-1, 2] cm, left/right |
|---|---|---|---|
| Walk_Loop (33 samples) | -0.00929 / -0.01031 | 0 / 1 | 22 / 22 |
| Walk_Formal_Loop (33) | -0.01216 / -0.01221 | 2 / 3 | 23 / 20 |
| Jog_Fwd_Loop (23) | 0.01358 / 0.00676 | 0 / 0 | 2 / 3 |
| Sprint_Loop (17) | -0.00472 / 0.02761 | 0 / 0 | 1 / 0 |

Jog selected-vertex endpoint discontinuity reaches 2.46 cm left / 1.06 cm
right; other sampled cycles repeat endpoint positions. Matching endpoints alone
does not prove velocity continuity or smooth playback.

Two-view sequences rendered for Walk_Loop (33 frames) and Jog_Fwd_Loop (23),
112 PNGs total, and encoded as 1280×640 H.264 at scene evaluation FPS 24.
Authored source FPS is unverified. Contact-sheet inspection shows alternating
steps and lifted feet, with heel/toe rotations visible in close-ups. It does
not establish a contact pass. Formal-walk and sprint sequences were not rendered.

Remote temporary artifacts under `/tmp/iframe-quaternius-20261007/`:

- `sole-diagnostic-final-20261029.json`: four-action numeric report.
- `sole-render-20261029.json`: two-action report corresponding to rendered frames.
- `sole-sequences-20261029/`: full-body and foot frames.
- `walk-sole-review.mp4` and `jog-sole-review.mp4`: single-cycle review videos.

Local review copies are under `/private/tmp/director-sole-review/`. These are
temporary diagnostic artifacts, not asset-library publications.

## Direct implication

The current transfer has measurable below-plane vertices in walking and limited
near-plane geometry in jog/sprint. Lowering foot-bone baselines was insufficient
to establish sole contact. Keep the candidate at intake and pelvis translation
off by default in the original diagnostic.

## Not yet proven

Near-ground vertices do not establish support. Horizontal speeds are reported
only for identical vertices near the plane in adjacent samples; no route/root
velocity is applied. Those speeds cannot certify or quantify gameplay/world-path
slip for an in-place clip. There is no support annotation, support-foot lock,
terrain adaptation or physical contact solver in this diagnostic.

## Hypotheses and next verification

Foot/ankle rest-axis differences and unmapped helper chains may contribute to
remaining contact errors, but this run did not isolate them. Next compare source
and target heel/toe orientation during explicitly labeled support intervals;
calibrate ankle/foot semantics before attempting foot locking. Then combine the
clip with a measured route velocity and inspect support displacement plus loop
position/velocity continuity. Do not hide the findings with a global height offset.

Verification: 22 focused tests, Python compilation, four-action final media run,
two-action sequence run and FFprobe frame-count/dimension checks. Catalog and
production playback were not changed.
