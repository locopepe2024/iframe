# Sole geometry and locomotion review diagnostic

## Scope

Extend the pinned Quaternius/media Blender probe; do not change playback or
promote intake assets. The input rig and mapping keep their existing hashes.
Ground is an explicit design plane Z=0 m. It is not inferred from a photo.

Select target mesh vertices with at least 0.5 total weight in the corresponding
foot/toe/helper groups, then select a 2 cm bottom band in the reset rest pose.
This is an inspectable sole-region approximation, not an anatomical label.
Keep vertex IDs fixed across frames; reject topology changes or empty regions.
Evaluate deformed world positions at each sampled frame.

Report vertex IDs, rest heights, per-frame sole minimum/maximum Z, ground
penetration below -1 cm, and proximity within [-1, 2] cm. For the same vertex
near ground in adjacent frames, report horizontal speed at the scene evaluation
FPS. This measures world motion of a sampled vertex, not support detection or
a pass/fail slip verdict. In-place clips require route/root velocity to assess
sliding; do not infer that velocity or label a near-ground frame as support.
Report seam position discontinuity separately from intra-cycle changes.

Optional sequence output renders all inclusive source frames in full-body and
feet views on media Blender, with a visible Z=0 plane. Record scene FPS; authored
FPS remains unverified. Use temporary files, no production asset writes.

## Verification

- Synthetic fixed/moving/airborne/penetrating vertices exercise metrics, units,
  frame gaps, invalid values and loop seams.
- Run the pinned four locomotion clips with pelvis translation on media Blender.
- Generate and inspect full-body and foot sequences; numerical/visual issues
  remain candidate findings, never automatic catalog readiness.
- Compare actual evaluated geometry rather than bone-tail heights.

Affected paths: the existing probe, a pure contact-metrics helper and focused
tests. Commands: focused pytest, py_compile, media Blender background probe,
FFmpeg sequence encoding. Admin owns merge/deployment.

## Ankle-pivot A/B experiment

Media rest-chain inspection shows source `DEF-foot` starts at the shin endpoint,
whereas target `foot` starts after the neutral `ankle` helper. Test an explicit
`--foot-pivot ankle` override: map source foot rotation to target ankle, leaving
target foot neutral. Preserve source-map SHA and record effective pairs and
neutral bones separately. Validate both sides' ankle→foot→DEF_foot→toe hierarchy
and aligned ankle/foot rest axes before applying. Default stays `foot`.
Compare four-action geometry metrics with identical pinned inputs; improvement
of minima alone cannot accept contact or prove ankle pivot is the sole cause.
