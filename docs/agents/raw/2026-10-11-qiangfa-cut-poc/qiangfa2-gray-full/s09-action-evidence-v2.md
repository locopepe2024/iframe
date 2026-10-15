# s09 source-frame evidence and action annotation v2

Review date: 2026-10-15. This supersedes the disputed direction and assembly notes in [v1](s09-action-evidence-v1.md); it does not overwrite the earlier review.

## Observed

- Original `枪法_2.mp4` SHA-256: `4db0b4023a2e2633eac245336cc2fffe06cb25e7cacdff8f4aec57a36bb2cec7`, 592x1280, 1840 video frames, nominal 30 fps. The original is a screen recording with phone status and player controls outside the performance rectangle.
- Review reference `s09-motion.mp4` SHA-256: `2e4324bd6284878954323fbe9a6c86edd4c178c43cecc168385d44aad3dd2a3c`, 592x336, 120 frames at 30 fps, 4.000 s. The [trial manifest](manifest.json) maps local frame `n` to original frame `1085+n`, original interval `[1085,1205)`, and confirmed cut at original frame 1197. Original frame 1150 and local frame 65 were visually checked for the same performance image; the cropped reference removes the phone UI.
- The [14-frame review sheet](s09-keyframe-review-2026-10-15.png) is row-major at local frames `30, 40, 45, 50 / 55, 65, 75, 87 / 99, 110, 111, 112 / 113, 119`. Each tile is an extracted frame from the cropped reference, not a recovered 3D motion path. Times below are local frame / 30.

| Local / original frames | Visible fact | Limits and acceptance relevance |
|---|---|---|
| 30 / 1115, 1.000 s | Torso leans forward with the shaft crossing near the upper body. | Far shaft extent is cropped. |
| 40–55 / 1125–1140, 1.333–1.833 s | Body folds markedly forward; the shaft stays broad and near horizontal above/behind the torso. Frames 45–55 remain deeply low. | Exact hands and path through blurred frames are unresolved; avoid claiming a specific grip change. |
| 65 / 1150, 2.167 s | Performer has recovered toward upright; shaft spans broadly across the body, red-tasseled end at **image left**. | Corrects v1's “low stance” and “red end right” at this frame. Do not infer the red-end path between sampled frames. |
| 75 / 1160, 2.500 s | Back turns toward camera; shaft crosses behind/across upper body, red-tasseled end visible toward **image right**. | Evidence of changed visible side, not proof of a continuous tip arc. |
| 87 / 1172, 2.900 s | Body upright; shaft angles steeply to image upper right, red end high at upper right. | Contradicts Kimi's “nearly horizontal pause” for this exact frame. |
| 99 / 1184, 3.300 s | Shaft extends approximately across the front, with red blur near image left edge. | Perspective and crop prevent a fixed physical-length measurement. |
| 110–111 / 1195–1196, 3.667–3.700 s | Closer side/front view with shaft spanning the chest and toward the near foreground. | Hands/shaft are blurred; exact contact cannot be scored. |
| 112 / 1197, 3.733 s | Abrupt change to a wider view and low posture; red end toward image left. | This is a camera edit, not a body movement between the two views. |
| 113, 119 / 1198, 1204 | Low second-view pose persists; red end rises toward image upper left by the last sampled frame. | Only eight second-view frames; no full finishing action or hidden grip transition is established. |

## Action recognition versus reviewed annotation

- Candidate names remain high lift, lowering, deep fold, recovery/turn, front extension. They describe observable phases, not certified martial-arts techniques.
- Promotable generation constraints: significant forward fold at 40–55; visible recovery by 65; red end left at 65 and right by 75 with intervening path uncertain; high diagonal at 87; broad front extension at 99–111; hard cut at 112; separate low second-view pose. No single “red side” rule should be imposed across the whole pre-cut motion.
- Do not assert exact hand placement, constant pixel spear length, a complete spear-tip arc, or an invented motion across frame 112.

## Not yet proven

- The manifest maps the cropped clip to source frames, and frame 1150 was visually cross-checked, but this review did not prove pixel-identical correspondence for all 120 frames or recover source PTS for every frame.
- A 4-second one-shot H3 generation can obey the 3.733-second cut, body phases, and prop geometry together; existing v2/v3 outputs failed those criteria.
- The old prompt file does not match the old task record hash; do not treat its current text as the exact historical request.

## What would verify it

Use the explicit event anchors above to align source and output, with cut sides reviewed independently. Review normal-speed motion and every uncertain interval before accepting. Any future prompt must identify the specific source-frame spans behind its phase and prop constraints.
