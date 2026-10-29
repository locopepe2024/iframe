# Explicit support contact evidence

Before IK, measure an explicitly selected target sole vertex over an explicitly
annotated support interval. Do not derive support from proximity. The input
annotation binds target/source SHA256, action, side, selected mesh/vertex ID,
inclusive start/end and per-frame world route translations. Route translations
are additive world offsets to an otherwise fixed-heading clip: rotated routes
and terrain are outside this slice. Ground is the design plane Z=0.

Each interval includes provenance `design_hypothesis` or `manual_review` and a
nonempty evidence note. Neither implies physical truth or acceptance. Require
at least two consecutive frames, fixed vertex topology, finite coordinates and
complete route coverage. Reject duplicate or overlapping same-side intervals.
Require both the annotation file and geometry probe input hashes to match.

Measure the same vertex in every frame: horizontal displacement from first
sample, maximum adjacent horizontal speed, Z range and requested displacement
to a fixed first-frame XY anchor at ground Z. The requested displacement is a
solver target only; do not modify skeleton, label drift as corrected, or emit a
passed contact state. Record route assumptions and annotation SHA in the report.

Verification: synthetic route cancellation and wrong-route drift, invalid
coverage/intervals and NaN. Media candidate run uses a clearly marked trial
interval, not a claim of authored support. No production changes or catalog
promotion. Follow-up solver must demonstrate reachability, knee continuity,
contact residual, release transitions and loop behavior before playback.
