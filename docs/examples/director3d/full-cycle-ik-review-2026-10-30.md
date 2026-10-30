# Full-cycle support IK gate review

## Observed

The current media trial is a five-frame interval (Walk_Loop 0..4), not a full
33-frame authored support cycle. The bounded solver reports a diagnostic cycle
gate: entry/exit weights are zero, maximum weight step is 0.5 and maximum
evaluated joint residual is 4.57e-7 m. This run used a fitted numerical route,
not a reviewed world trajectory.

Post-IK selected-vertex results show maximum horizontal drift 0.000451 m and
maximum adjacent horizontal speed 0.00717 m/s. Full-weight frame 2 has sole
anchor residual 0.000556 m. Endpoint residuals remain 0.03838 m and 0.01798 m
because the envelope deliberately releases at both boundaries. The cycle gate
reports `supportAccepted: false`.

## Direct implication

The bounded IK and release envelope work numerically on the constrained trial:
the fitted route cancels nearly all horizontal drift while preserving explicit
release behavior. This does not prove the route is correct or the frame is an
authored support phase.

## Not yet proven

No full-cycle support labels, dual-foot constraints, support transitions,
velocity continuity, route truth, terrain, or rendered post-IK sequence have
been accepted. The current gate intentionally rejects contact as a product
status. Extending the fitted route across all frames would only make a larger
plumbing test, not establish no-sliding.

Next verification requires manually reviewed heel/toe intervals and measured
world paths, then a 33-frame two-foot render with residual and release checks.
