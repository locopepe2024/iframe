# Support route continuity review

## Observed

Media Blender 4.5.9 LTS ran the corrected route metric against the existing
alternating Walk_Loop fixture (left 0..8, right 16..24) at 24 FPS. The result
is now `continuous: false`: frames 9..15 are missing (7 frames). The previous
report incorrectly said no gaps because it only compared same-side intervals.
The historical per-segment maxima, 1.40866 and 1.53365 m/s, do not establish
continuity between intervals.

A synthetic adjacent cross-foot route with 0.01 m/frame passed the same media
check. Local regression tests also cover cross-foot jumps, same/cross-foot gaps,
overlap conflicts, bridge samples, invalid input and separate action timelines.
These media checks executed the metric in Blender; they did not rerender or
rerun the complete retarget/IK pipeline.

## Direct implication

The opt-in support IK gate now blocks this alternating fixture until the
missing world-route samples are supplied. Adjacent endpoints are measured
instead of being called missing bridges. Action timelines are checked separately.

## Not yet proven

The reported scope is only the annotated span per action. Action endpoints,
loop closure, acceleration, visual gait quality, terrain and no sliding remain
unverified. No new animation acceptance or production playback change is claimed.
