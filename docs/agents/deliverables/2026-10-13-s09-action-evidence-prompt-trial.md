# s09 action-evidence prompt trial

## Observed

- Source segment: original frames `[1085,1205)`, 30 fps, with a hard cut at frame 1197 (local 3.733 s). The [frame evidence and reviewed annotation](../raw/2026-10-11-qiangfa-cut-poc/qiangfa2-gray-full/s09-action-evidence-v1.md) separate visible poses from candidate action names. No named gunshu technique or hidden grip transition was asserted.
- The [new prompt](../raw/2026-10-11-qiangfa-cut-poc/qiangfa2-gray-full/s09-action-v2-prompt.md) follows the reviewed high, lowering, low, rising, front extension and cut sequence. Its H3 structural checker passed.
- H3 task `task_mccFPqEplWJgITmnXw3o2VBE8tvsvzpS` completed. The [task record](../raw/2026-10-11-qiangfa-cut-poc/qiangfa2-gray-full/s09-action-v2-generation.json) confirms the same target image hash, motion clip hash, model, mode, duration, resolution, ratio, audio setting and seed `20261011` as the baseline. The prompt hash changed. The [new video](../raw/2026-10-11-qiangfa-cut-poc/qiangfa2-gray-full/s09-action-v2-replacement.mp4) is 90 frames at 24 fps, 3.75 s, matching the old provider output duration.
- In the [same-time comparison](../raw/2026-10-11-qiangfa-cut-poc/qiangfa2-gray-full/s09-action-v2-comparison.png), rows are source, baseline and new trial. Columns are local source times 0.000, 0.667, 1.333, 2.167, 2.667, 3.333 and 3.800 s. Provider frames were selected at proportional output times because both outputs last 3.75 s.

| Acceptance point | Baseline | New trial | Result |
|---|---|---|---|
| Target person | Long-haired source performer and skirt persist | Silver-haired man with dark jacket and trousers appears across sampled frames | Improved in sampled frames |
| Action phase | Some source poses appear, but sequence and timing differ | High start, lowering and later extension appear; deep bend around source 1.3-1.8 s is shallow/early, later phases differ | Still fails motion fidelity |
| Spear | Long shaft appears, with variable crop and length | One shaft appears, but the metallic tip and tassel are enlarged; length/position differ from source | No demonstrated improvement |
| Cut at 3.733 s | Not clearly reproduced in sampled baseline | Last 12 output frames keep one continuous view and pose; no corresponding hard cut | Fails |
| Screen chrome | Browser/player border and controls visible | No screen-recording chrome in sampled frames or last 12 frames | Improved |

## Direct implication

This prompt-only trial improves visible identity replacement and clean-frame appearance but is **not an accepted s09 recreation**. It does not meet the action-phase, spear-geometry or cut criteria, so it should not replace s09 in full-film assembly. The single run demonstrates an observed output difference, not that any particular wording caused the improvement.

## Not yet proven

- The historical task record stores baseline prompt hash `dee1febb...`; the current old prompt file hashes to `de6652fa...`. Therefore the exact historical wording cannot be reconstructed from the current file, although the other recorded inputs match.
- Whether the model ignored the cut instruction, underweighted the action reference, or responded to another factor is unknown. A fixed seed does not prove deterministic provider output.
- Sampled frames do not establish continuous hand contact or spear length across every frame. The new output has not received an independent normal-speed user acceptance review.

## What would verify it

For the next s09 experiment, isolate the failed motion/cut constraint while keeping the verified identity and clean frame: test a motion reference split at original frame 1197 or an explicit two-shot assembly, then compare at the same seven times and inspect the full transition around 3.733 s. Do not promote to a full-film batch until s09 passes identity, action phase, spear geometry and chrome checks together.
