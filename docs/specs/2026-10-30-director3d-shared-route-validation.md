# Shared world route validation

Independent fitted foot routes can make two-foot IK appear numerically stable
while describing incompatible world motion. Before any dual-foot trial, compare
route translations on overlapping frames. A route is shared when each side's
XYZ translation differs from the first side by at most 0.1 mm. Non-overlapping
intervals are not compared; their continuity must be checked separately.

This is a consistency gate, not a physical route validator. It does not infer
walking speed, heading, terrain or authored intent. Reports remain
`diagnostic_only`; conflicts fail the shared-route claim but do not reject the
underlying single-foot measurement. Production playback and catalog status are
unchanged.
