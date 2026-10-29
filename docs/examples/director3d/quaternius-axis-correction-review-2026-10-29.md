# Rest-axis correction experiment

## Observed

Media Blender 4.5.9 evaluated 106 frames of the four pinned clips, with pelvis
translation, ankle pivot and optional rest-axis correction. A preliminary
source-to-target pre-multiplied correction was superseded: the final calculation
uses target-to-source correction between source delta and target rest rotation.
Only the final v2 report supports the following findings.

| Clip | Ankle baseline minimum L/R (m) | Corrected minimum L/R (m) | Corrected frames below -1 cm L/R |
|---|---|---|---|
| Walk_Loop | -0.00652 / -0.00418 | -0.02171 / -0.02248 | 10 / 13 |
| Walk_Formal_Loop | -0.00982 / -0.00658 | -0.02452 / -0.02446 | 11 / 8 |
| Jog_Fwd_Loop | 0.01805 / 0.01181 | 0.00875 / 0.00213 | 0 / 0 |
| Sprint_Loop | -0.00334 / 0.02347 | -0.01324 / 0.00969 | 1 / 0 |

Reported anatomical foot-axis angular error rounds to zero across all sampled
frames after correction. This is floating-point angle output, not exact identity.
Walking penetration nonetheless becomes worse: up to about 2.45 cm. No new
corrected sequence was rendered because the numerical walking gate failed.

## Direct implication

Aligning the source/target foot axis is insufficient for geometric contact on
different foot shapes and proportions. Reject this correction for default
playback. Keep it as an explicit diagnostic option, off by default. No catalog
promotion, support-foot locking or production mapping change is justified.

## Not yet proven and next verification

Support intervals, route velocity, heel/toe rolling and solver behavior remain
unvalidated. A possible next approach is target-specific sole/contact frames
and constrained ankle IK during annotated support intervals; that is a
hypothesis requiring a separate design and test, not an outcome of this run.

Final raw report on media:
`/tmp/iframe-quaternius-20261007/axis-corrected-v2-20261029.json`.
The companion JSON summary records its hash, correction quaternions and metrics.
