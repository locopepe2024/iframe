# s09 source-frame evidence and action annotation

Source: `s09-motion.mp4`, SHA-256 `2e4324bd6284878954323fbe9a6c86edd4c178c43cecc168385d44aad3dd2a3c`, 120 frames at 30 fps. Local frame `n` maps to original frame `1085+n`; local time is `n/30` seconds. This review inspected every fifth local frame, plus local frames 110-119. The listed spans are evidence windows, not verified exact action boundaries. The source image is 592x336, so hand placement and the thin spear point are often unresolved.

## Observed: source-frame evidence

| Local / original frame | Time | Visible body and prop evidence | Limits |
|---|---:|---|---|
| 0 / 1085 | 0.000 | Performer upright, arms high; a long shaft crosses above the head, red tassel at image left. | Grip points are obscured. |
| 10 / 1095 | 0.333 | Shaft rises from the upper body toward image top; torso remains upright. | Fast shaft motion and crop hide its full extent. |
| 20 / 1105 | 0.667 | Red tassel blurs near the head; performer has begun turning and lowering the shaft. | Cannot recover an exact spear-tip trajectory. |
| 30 / 1115 | 1.000 | Torso leans forward; shaft extends approximately horizontally across the upper body toward image right. | The far end is outside the image. |
| 40-55 / 1125-1140 | 1.333-1.833 | Performer folds low, then starts to rise; shaft stays broadly lateral above/behind the lowered torso. | Exact footwork, grip and continuous path are hidden by motion blur and off-frame ends. |
| 65 / 1150 | 2.167 | In a low stance, shaft lies diagonally across the shoulder/body; the red end appears toward image right. | Whether this is a named sweep or recovery cannot be established. |
| 70-80 / 1155-1165 | 2.333-2.667 | Performer rises and lifts the shaft, then turns so the back faces camera; one shaft end reaches upward. | This is a visible turn, not evidence of a specific martial-arts technique. |
| 90-105 / 1175-1190 | 3.000-3.500 | Performer extends the shaft broadly across the front; red tassel moves from image left toward the near foreground. | Foreground blur prevents a fixed pixel-length estimate. |
| 110-111 / 1195-1196 | 3.667-3.700 | Side-facing performer holds shaft across chest; image right end reaches the frame edge. | No certain release or regrip visible. |
| 112 / 1197 | 3.733 | Hard cut to a wider view; performer is lower and farther from camera, red-tasseled end at image left. | The camera change is a cut, not continuous body travel. |
| 113-119 / 1198-1204 | 3.767-3.967 | In the second view, low stance persists while the red end rises slightly at image left and the other end angles down right. | Only eight frames remain; no complete finishing action is visible. |

The sampled source clip has no browser toolbar or player controls. The baseline output does show such chrome, so it is an output defect rather than a source-frame requirement.

## Action recognition: candidates

- High overhead turn/lift, roughly local frames 0-25. Candidate label only; precise rotation direction and technique are unverified.
- Lowering and broad lateral sweep, roughly frames 25-65. Candidate label describes visible shaft/body change, not a certified `扫枪` technique.
- Rise, turn and forward/lateral extension, roughly frames 65-111. Shaft path and grip transitions remain partly obscured.
- A separate low pose after the hard cut at frame 112. Do not connect the two camera views as continuous motion.

## Action annotation: reviewed constraints for generation

1. Frames 0-20: begin upright with the long shaft high; preserve the visible red end and the quick downward/turning change. Evidence: 0, 10, 20.
2. Frames 25-55: torso bends substantially lower while the long shaft remains broad and mostly lateral; avoid turning this into a sustained upright pose. Evidence: 30, 40-55.
3. Frames 60-80: recover upward, carry the shaft diagonally, then turn with an end lifted. Evidence: 65, 70-80. Exact grip and technique remain unassigned.
4. Frames 85-111: extend the shaft across the front and toward the near foreground at a brisk pace; keep one visibly long, rigid shaft. Evidence: 90-111. Apparent pixel length varies through perspective and crop, so acceptance is coherent geometry rather than a constant pixel length.
5. At frame 112 (3.733 s): use a hard cut to the lower, wider second view. Evidence: 110-113. Do not interpolate a movement across this edit.
6. Frames 112-119: retain the low posture and left-high/right-low shaft orientation through the end. Evidence: 112-119. No inferred final flourish.

## Not yet proven

- No reviewed evidence establishes exact hand positions, complete spear-tip arcs, named gunshu moves, or a constant physical spear length.
- The original submitted prompt text is not recoverable from the current file: task record hash `dee1febb...` differs from the current `s09-prompt.md` hash `de6652fa...`. The historical task and output remain the baseline, but prompt wording cannot be controlled retrospectively.
- A prompt-only change may not overcome identity carryover or UI chrome. Provider behavior requires the generated comparison.

## Verification points

At local times 0.0, 0.667, 1.333, 2.167, 2.667, 3.333 and 3.8 s, compare source, baseline and trial for identity, action phase, spear geometry and UI chrome. Compare the cut at 3.733 s separately. Use normalized time for the 3.75 s provider outputs, recording that retiming is needed for a four-second assembly.
