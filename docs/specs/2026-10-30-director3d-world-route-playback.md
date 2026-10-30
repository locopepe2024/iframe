# Offline complete world-route playback

Apply validated director3d-world-route.v1 offsets to the pinned white model on
all action frames. Keep existing per-frame retarget and optional support IK in
unrouted coordinates. IK uses the canonical support slice as its virtual offset;
after IK, translate the target hierarchy once, then measure/render evaluated world
geometry. Measurement must use zero additional route to avoid double application.

Capture baseline world transforms of target mesh/armature hierarchy roots after
loading the assets, selecting meshes by their target armature modifier. Restore them after frame_set on every frame; apply world translation
from baseline, never accumulate. Reject roots with constraints or animation, since
restoring them would hide authored movement. Leave source and scene objects fixed.
Validate all selected action ranges, hashes, FPS and support slice equality before
playback. With a full route, use its full-frame continuity gate rather than gaps
in the support annotations. Without it preserve previous diagnostic behavior.

Success: in media Blender compare routed/unrouted evaluated pelvis and every sole
vertex, including unsupported frames; deltas must match requested offsets within
0.1 mm. Repeat with IK and verify route isn't doubled; render a whole-cycle preview.
No heading, terrain, loop acceptance, production playback or catalog promotion.
