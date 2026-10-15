# s09 action timeline density: preliminary frame comparison

Date: 2026-10-15. This is a read-only comparison of existing media, with no new generation. Source: `s09-motion.mp4` (120 frames, 30 fps, 4.00 s). Outputs: `s09-action-v2-replacement.mp4` and `s09-precut-hold-v3-replacement.mp4` (each 90 frames, 24 fps, 3.75 s). All are in `../raw/2026-10-11-qiangfa-cut-poc/qiangfa2-gray-full/`. Source local frame 112 is a hard cut; the table below stops before it.

**Correction after consecutive-frame review:** the source has a first high lift at frames 69–73, a lower/back-turn phase at 74–81, and a second high lift at 82–87. The earlier comparison of output first lift with source frame 87 incorrectly matched different events. See [the source review](2026-10-15-s09-source-sequential-review-v1.md). The first-lift timing and whether either output preserves both lifts require new event pairing; the deep-fold finding remains.

## Observed

Frames were inspected at a stride of three: source 24–111 (0.10 s per sample), outputs 18–87 (0.125 s per sample). Intervals below are **visible sampled ranges**, not exact action boundaries. Uncertainty is at least one sampling interval on either side, and some prop directions are blurred or cropped.

| Visible phase | Source sampled frames / time | v2 sampled frames / time | v3 sampled frames / time |
|---|---|---|---|
| Marked forward fold with broad near-horizontal shaft | 39–57 / 1.30–1.90 s; deepest around 45–54 | 27–42 / 1.125–1.750 s; torso remains visibly shallower | No comparably deep fold in 18–87; low forward lean around 27–39 only |
| Recovery toward upright | 60–66 / 2.00–2.20 s | 45–48 / 1.875–2.000 s | Already largely upright around 42–48 / 1.750–2.000 s |
| First raised or steeply diagonal shaft | 69–73 / 2.300–2.433 s | candidate around 51–54 / 2.125–2.250 s; equivalence unresolved | candidate around 42–48 / 1.750–2.000 s; equivalence unresolved |
| Lower/back-turn interval, then second lift | lower/back-turn 74–81 / 2.467–2.700 s; second lift 82–87 / 2.733–2.900 s | corresponding two-event pattern not yet scored | corresponding two-event pattern not yet scored |
| Broad front extension | visible near 99–111 / 3.30–3.70 s | near 72–81 / 3.000–3.375 s; later view and oversized tip differ | near 72–87 / 3.000–3.625 s; tip and perspective differ |

The source deep-fold sampled interval spans at least 18 frame steps / 0.60 s; v2's shallower low pose spans at least 15 steps / 0.625 s. These are **not equivalent motion phases**, so their similar durations do not establish matching rhythm. The source's first high lift occurs at 2.300–2.433 s, followed by a lower/back-turn interval and a second lift at 2.733–2.900 s. Output lift candidates cannot be assigned a timing error until these repeated events are matched by semantics and order. The source cut at 3.733 s has no matching cut in either output.

## Direct implication

The useful temporal unit is an **event interval**: onset, peak/hold, recovery, direction reversal, and cut. A video with fewer encoded frames can preserve the same real-time event intervals; 30 fps versus 24 fps alone does not explain the mismatch. For s09, v2's low phase is too shallow, and whether either output preserves the source's two lifts with the intervening lower/back-turn phase remains unresolved. Equal-duration screenshots and a single speed multiplier cannot resolve this.

## Not yet proven

- Whether the source itself was edited with variable speed, and whether high-motion windows have a different *source motion density* from quieter windows. Source frame count alone does not measure motion magnitude.
- Exact onsets, peaks and directions between sampled frames; full grip and tip trajectories are partly obscured.
- That denser sampling, a different reference window, or more precise timing language will cause H3 to follow the source. Existing outputs differ in more than timing, including pose depth and prop geometry.

## Hypotheses

- A prompt or reference that marks high-change events and low-motion holds with separate frame spans may reduce phase compression and premature transitions. This needs a controlled generation test.
- Cutting the source at frame 112 before generation may remove one timing conflict, but cannot by itself explain the earlier deep-fold failure; the pre-cut-hold v3 test did not fix it.

## What would verify it

1. Review every source frame around 33–66 and 75–99, and every output frame around the corresponding low, recovery and lift phases. Mark first/last **observable** evidence plus uncertain boundaries. Track torso inclination, visible shaft orientation, red-end side and occlusion separately.
2. Register paired event anchors before another generation: fold onset/lowest hold/recovery, lift onset/high diagonal, front extension. Compare adjacent real-time intervals and their ratios with a monotone mapping inside the first view; treat absent or non-equivalent output events as failures, not timing values.
3. In one controlled single-view trial, keep the identity image, model settings and seed fixed; use a source window and prompt whose event spans agree. Preserve the exact request and output hashes. Accept an improvement only if the same output also passes pose depth, spear continuity and clean-frame checks at normal speed.

This is evidence of **local phase mismatch**, not proof that nonuniform timeline density is its cause.

## Source edit compression and output sampling (2026-10-15 clarification)

The user's more specific hypothesis is that fast source actions were editorially compressed: intermediate captured poses were removed and the retained poses were assigned closer **playback** times. In the illustrative 100 ms to 25 ms case, that is a 4x shorter interval between retained poses. Dropping frames alone does not determine speed; assigning new timestamps or conforming the retained frames to a fixed playback rate does. The original capture timeline or edit decision list is needed to prove that particular 4x transformation.

**Runtime observation:** `ffprobe` reports all 119 adjacent PTS intervals in this cropped s09 reference as approximately 33.333 ms (79 at 0.033333 s and 40 at 0.033334 s after decimal rounding). This constant-rate export cannot reveal earlier frame removal or source retiming. It also cannot show a literal 25 ms interval between displayed s09 frames. The 25 ms example remains a mechanism hypothesis, not an observed s09 interval.

**Algorithm implication:** At 24 fps, adjacent output frames are 41.667 ms apart. If two distinct source poses must both be displayed 25 ms apart, a 24 fps output cannot represent both as separate frames at identical playback times. It can omit one pose, represent their passage with motion blur, or alter timing. This sampling limit does **not** by itself show that H3 slows motion; a 24 fps output can preserve the overall event duration while omitting some intermediate poses. Whether H3 interpolates, smooths, or stretches a specific interval requires output-frame evidence.

**Validation change:** First detect candidate within-shot compression in the source with consecutive-frame posture, shaft-angle and red-end changes, excluding the cut at frame 112 and marking blur/occlusion. Compare these changes with slower neighboring windows and, ideally, the unedited capture or edit metadata. Then build a local 30-to-24 fps baseline at unchanged real-time duration to see which visible events are lost through ordinary resampling. Finally compare H3 event order and time intervals against both source and baseline. A generation prompt should specify *observed event times and holds* rather than infer an unverified original-speed action between retained frames.

**Local resampling control:** `ffmpeg -i s09-motion.mp4 -vf fps=24` produced 96 frames over the same 4.000 s. At output frames 32, 36 and 44 (1.333, 1.500 and 1.833 s), the marked forward fold remains visible; frame 52 (2.167 s) shows recovery; frame 70 (2.917 s) shows the **second** raised shaft. Thus ordinary 30-to-24 fps conversion at fixed duration retains these coarse s09 anchors. It does not account for the existing H3 outputs' shallower/missing fold. This control does not test H3's internal sampling, nor prove whether the input was retimed before export.
