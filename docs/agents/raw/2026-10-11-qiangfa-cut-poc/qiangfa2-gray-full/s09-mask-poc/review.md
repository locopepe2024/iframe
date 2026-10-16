# s09 foreground mask and green-screen preview review

Date: 2026-10-16. This is a local, unpaid segmentation probe. It does not alter the source video, submit a provider request, or claim production mask quality.

## Inputs and method

- Input: `../s09-motion.mp4`, 592x336, 30 fps, 120 frames. Representative local frames: 45 (deep fold), 65 (recovery), 70 (first high lift), 75 (lower/back turn), 84 (second high lift), 87 (second high-lift diagonal), 111 (pre-cut front extension), 112 (post-cut view).
- Each frame was decoded with FFmpeg `select=eq(n\,FRAME)` without interpolation.
- `s09_person_mask_probe.swift` uses macOS Vision `VNGeneratePersonSegmentationRequest` and writes a same-size mask plus a green-background preview.
- `s09_foreground_mask_probe.swift` uses macOS Vision `VNGenerateForegroundInstanceMaskRequest` over all returned instances and writes a same-size mask plus a green-background preview.
- Review sheets: `person-segmentation-review-sheet.png` and `foreground-instance-review-sheet.png`. Each row is source / mask / green preview; row labels are local frame numbers.

## Observed

### Person segmentation

- Frame 45's person mask is effectively empty, so the deep-fold pose disappears in the green preview.
- Frames 65 and 70 retain much of the body but omit the long shaft and red tassel.
- Frame 75 is largely empty; frame 84 omits the raised shaft and much of the subject boundary.
- Frames 87, 111 and 112 retain a body silhouette but still omit or fragment the spear and tassel.

### Foreground instance segmentation

- The foreground-instance pass retains a recognizable body in all eight representative frames and captures a visible shaft in frames 70, 75, 87, 111 and 112.
- Frame 45 still has a body-only/partial foreground with no reliable shaft; frame 84 retains a body silhouette but loses most of the near-vertical shaft and tassel.
- Thin shaft coverage varies across adjacent phases. A successful green preview at one frame does not prove temporal continuity or hand/shaft attachment.
- The green preview makes errors visible, but green is only a review background. It is not a mask source and does not repair missing pixels.

## Human review decision

- Person segmentation: **rejected for s09 motion guidance**. It fails on a decisive deep-fold frame and does not include the prop.
- Foreground instance segmentation: **draft accepted for further manual correction; not approved for generation**. It is useful for body visibility review but needs a separate spear/red-tassel mask or hand correction, especially at frames 45 and 84.
- No mask is promoted to an `ActionTimelineRevision` fact. Missing mask pixels are `segmentation_unknown`, not evidence that the body or spear was absent.
- The source frame remains the authority for action semantics, timing, cut boundaries and visible background. A mask can expose or isolate pixels for review; it cannot infer hidden grip or a continuous spear path.

## Next verification

1. Correct foreground-instance masks at frames 45, 70, 75, 84, 87 and neighboring frames, with body and spear/tassel reviewed as separate regions.
2. Inspect the green preview alongside the original frame at normal speed around the first high lift, lower/back turn, second high lift and frame 112 cut.
3. Record per-frame `approved`, `needs_correction`, or `unscorable` with reasons. Only an approved mask revision may be attached to a future generation plan; this probe has no generation input attachment.
