# Full-cycle contact isolation trial

Extend the offline support IK diagnostics only. Success means evaluating all
33 Walk_Loop samples, checking each side/interval independently, recording
release endpoints, verifying untouched frames and comparing loop positions.
It does not mean authored support or full-cycle no-slide acceptance.

Export optional fixed-vertex trajectories with source/target identities and
evaluation stage. Construct repeatable numeric fixtures from the baseline:
left 0..8 and right 16..24 for alternating constraints, plus simultaneous
left/right 0..4 for solver isolation. Select the fixed candidate vertex with
smallest maximum absolute Z over each test interval; record that selection
as a design hypothesis, never manual review or anatomical truth. Fit per-interval
XY offsets to those original vertices. Independent fitted routes in the
simultaneous fixture explicitly do not describe one coherent world trajectory.

Reject invalid residuals, non-releasing weights and frame gaps. Group reports
by side and interval so simultaneous frames do not produce duplicate-frame
errors. Render all inclusive frames for the alternating fixture; retain raw
reports and trajectories in temporary media storage, with report hashes and
compact metrics in the repository. No production mapping or catalog changes.

Verify focused tests, media Blender with --python-exit-code 1, fixed vertex
differences outside intervals, endpoint geometry and FFprobe frame count.
Inspect contact-sheet poses separately from numerical continuity. Position
seam agreement alone does not prove velocity continuity.
