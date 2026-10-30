# Support route continuity validation

Shared route equality prevents contradictory simultaneous foot routes. This
second gate measures each annotated route segment's world speed at evaluation
FPS and refuses to claim continuity when a segment exceeds a declared speed
limit (default 4 m/s). Adjacent same-side intervals with missing bridge frames
are reported as gaps and are not treated as continuous.

The check is diagnostic only. A speed limit is a review constraint, not a
walking-speed classifier; a passing segment does not prove authored intent,
heading, terrain or no sliding. The gate runs before opt-in dual-foot IK, while
single-foot measurements remain available for debugging. Production playback
and catalog status are unchanged.
