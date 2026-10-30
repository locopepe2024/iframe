# Support route continuity validation

The diagnostic validates finite XYZ samples, groups intervals by action, and
compares every consecutive covered frame in their union, regardless of foot.
Adjacent interval endpoints are measured at evaluation FPS; a missing frame
blocks continuity, without interpolating or judging endpoint average speed.
Overlapping conflicting proposals also block continuity. The declared speed
limit defaults to 4 m/s and is a review constraint, not a gait classifier.

Success criteria: cross-foot jumps fail, unobserved internal frames fail,
consistent overlap can bridge intervals, and separate actions do not share a
timeline. Validate with the route tests and media Blender 4.5.9 fixture checks.
Affected paths: shared_route_metrics.py, the offline retarget probe, route tests.

The scope is only the first through last annotated frame per action. A passing
result does not cover action endpoints outside that span, loop closure,
acceleration, heading, authored intent, terrain or no sliding. The gate runs
before opt-in support IK. Production playback and catalog status are unchanged.
