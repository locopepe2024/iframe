# Foot pivot video and axis review

## Observed

Media Blender rendered side-by-side full-body/feet sequences for `Walk_Loop`
and `Walk_Formal_Loop`, comparing the default target `foot_l/r` destination
with the diagnostic `ankle_l/r` destination. The four-action geometry run and
the two walking sequence runs completed on the pinned target blend.

The rest anatomical foot-axis angle is 8.7004 degrees on both sides. The
diagnostic preserves that rest mismatch; it does not compensate it. The axis
sample is therefore a mapping calibration measurement, not an animation
quality score. The A/B reports remain temporary under the media host.

## Direct implication

The ankle pivot produces visibly plausible alternating steps in the review
sequence and removes the sampled walking penetration frames reported by the
default pivot. It is a better walking candidate than the default pivot for this
target rig. The source/target foot axis still differs by about 8.7 degrees, so
the current mapping is not yet an exact foot-orientation match.

Jog and sprint remain unresolved: ankle pivot leaves most selected sole samples
airborne and does not eliminate jog cycle endpoint displacement. This change
must not be enabled globally from the A/B alone.

## Not yet proven

The video is a visual reference render, not a contact acceptance test. No
support intervals, route/root compensation, IK, terrain adaptation or measured
sliding verdict exists. The axis diagnostic currently reports rest/current
orientation evidence but does not solve the 8.7-degree correction.

## Next step

Add an explicit rest-axis correction experiment, with a report of the correction
quaternion and sole metrics, then compare the corrected ankle pivot against the
current ankle pivot. Keep both candidates out of the playable catalog until
support-phase and loop-velocity checks pass.
