# Contact-plane rotation request replay

Runtime observation: media Blender 4.5.9 LTS replayed the 18 saved evaluated
white-model contact frames from the refined Walk_Loop fixture (24 FPS). Input,
source and target SHA-256 values are recorded in `check.json`.

- 14 requests align the fitted upward normal with world +Z; maximum vector
  alignment error is 1.59e-7 using Blender mathutils.
- Four requests are rejected by the unchanged 8 degree bound: left frames 0/1
  (14.74/12.95 degrees), right frames 16/17 (13.85/13.57 degrees).
- On copied point geometry, the first full-weight left/right fitted tilts change
  from 5.207/5.461 degrees to 0.0879/0.0916 degrees. The re-fitted patch is not
  exactly horizontal because this is a noisy vertical least-squares fit, not a
  rigid planar patch.

Code fact: the previous negative angle rotated these normals away from +Z.
The fix uses a positive angle around `(-b,a,0)` for `z=ax+by+c`. Regression tests
rotate actual synthetic point coordinates, rather than checking the angle alone.
Plane fitting also now centers world coordinates, and the phase report records
every frame and explicitly identifies its retained first-frame fields.

Not yet proven: these requests improve a skinned foot or retain an anchor after
bone rotation. This replay only rotates copies of measured points: it does not
modify bones, route, animation, ground height, or production playback. No new
animation video is claimed. Ground locking, no sliding, terrain adaptation and
contact acceptance remain unverified.

Reproduce on media (paths refer to the retained experiment data):

```sh
/opt/blender-4.5.9/blender -b --python-exit-code 1 \
  --python /tmp/director-plane-rotation-20261031/check_contact_plane_rotation.py -- \
  --report /tmp/director-sole-refinement-20261030/refined.json \
  --output /tmp/director-plane-rotation-20261031/check.json
```

The replay script and its `bounded_support_ik.py` / `support_contact_metrics.py`
dependencies come from `scripts/director3d/`. It consumes the probe JSON output;
it does not require loading a model or re-rendering frames. The next integration
must validate the target bone hierarchy, preserve the cumulative 5 cm bound,
blend entry/exit, and remeasure the deformed mesh before any acceptance claim.
