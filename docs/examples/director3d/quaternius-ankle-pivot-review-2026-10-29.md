# Ankle-pivot A/B review

Media Blender 4.5.9 reran all four clips with pelvis displacement and sole
geometry enabled. The A/B only changes the effective source foot destination:
`foot_l/r` (default) versus `ankle_l/r`; target foot/toe chains remain explicit
and the input map is unchanged.

| Clip | Default lowest L/R (m) | Ankle-pivot lowest L/R (m) | Default penetration frames L/R | Ankle penetration L/R |
|---|---:|---:|---:|---:|
| Walk_Loop | -0.00929 / -0.01031 | -0.00652 / -0.00418 | 0 / 1 | 0 / 0 |
| Walk_Formal_Loop | -0.01216 / -0.01221 | -0.00982 / -0.00658 | 2 / 3 | 0 / 0 |
| Jog_Fwd_Loop | 0.01358 / 0.00676 | 0.01805 / 0.01181 | 0 / 0 | 0 / 0 |
| Sprint_Loop | -0.00472 / 0.02761 | -0.00334 / 0.02347 | 0 / 0 | 0 / 0 |

## Direct implication

The ankle-pivot experiment removes the sampled below-plane vertices in both
walking clips and reduces their penetration risk. It does not make jog/sprint
support continuous: jog remains mostly airborne and retains 2.51 cm / 0.89 cm
cycle endpoint displacement; sprint right remains above the near-ground band.
The pivot is a promising mapping correction for walking, not a contact solver.

## Not yet proven

The metric uses a weighted rest-pose bottom band and no authored support labels,
route velocity or IK. Near-plane counts and adjacent speeds therefore cannot
certify lock, no sliding or terrain adaptation. Visual review of full sequences
is still required before changing the production mapping.

The diagnostic report is temporary at
`/tmp/iframe-quaternius-20261007/ankle-pivot-20261029.json`; the branch does not
publish or change the catalog. Next step is a side-by-side rendered walk and
formal-walk comparison, then an explicit source/target foot-axis calibration.
