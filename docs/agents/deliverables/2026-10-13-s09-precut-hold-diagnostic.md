# s09 pre-cut hold diagnostic

## Observed

- This trial changed the motion reference from `s09-motion.mp4` to [s09-precut-hold-motion.mp4](../raw/2026-10-11-qiangfa-cut-poc/qiangfa2-gray-full/s09-precut-hold-motion.mp4): local frames 0-111 retain the pre-cut view and frames 112-119 repeat frame 111. The resulting clip remains 120 frames, 30 fps and four seconds. Its first 112 decoded frames differ slightly from the original because the file was re-encoded (mean PSNR 47.60 dB). The change is predominantly the removal of the eight-frame second view, not pixel-identical isolation.
- The [task record](../raw/2026-10-11-qiangfa-cut-poc/qiangfa2-gray-full/s09-precut-hold-v3-generation.json) shows the same target image hash, v2 prompt hash, model, mode, duration, resolution, ratio, audio setting and seed `20261011` as the previous trial. Only the motion file hash changed among those recorded inputs. H3 task `task_qLkjQL0DskI50pVDIgqyPeT0JUV44gAh` completed; the [output](../raw/2026-10-11-qiangfa-cut-poc/qiangfa2-gray-full/s09-precut-hold-v3-replacement.mp4) again contains 90 frames at 24 fps and lasts 3.75 seconds.
- The [same-time comparison](../raw/2026-10-11-qiangfa-cut-poc/qiangfa2-gray-full/s09-precut-hold-v3-comparison.png) shows source, previous v2 and v3 in rows, at local source times 0.000, 0.667, 1.333, 2.167, 2.667, 3.333 and 3.800 s. Output samples use proportional positions within their 3.75-second duration.
- v3 keeps the target older man and shows no screen controls in the inspected samples. At source time 1.333 s, the body is deeply folded; v3 remains substantially more upright. At source 2.167 s, the long shaft is lateral in a low phase; v3 has already returned to a high diagonal shaft. At 3.333 s, both generated versions extend the spear, but its tip and tassel are enlarged relative to the source. The last 12 v3 frames hold one view and a nearly fixed pose.

## Direct implication

Removing the source's eight-frame second view did not produce an observable correction to the main pre-cut action failures. It also does not yield a usable s09 replacement: the 3.733-second cut is intentionally absent from the diagnostic motion input, while the unchanged prompt still requests it. Identity and clean-frame gains remain, but action phase and spear geometry fail. Do not assemble v3 into the full video.

## Not yet proven

- The re-encoding of frames 0-111 and possible provider nondeterminism prevent a strict causal attribution of every v2/v3 difference to the tail change.
- v3 cannot test whether H3 can follow a hard cut when the second view is present, because that visual evidence was removed. The prompt and motion reference conflict on this point.
- The model's interpretation of the spear tip, the cause of missed deep bending, and whether finer temporal prompts can fix either are unresolved.

## What would verify it

The next useful s09 test should target the dominant failure directly: use a short pre-cut motion window with the deep bend visible and verify its generated action phase before adding an independently handled second view. Preserve the same identity image and compare normal-speed playback plus source-aligned samples. Treat the cut as an explicit edit or two-shot assembly only after both shots pass their own motion and prop checks.
