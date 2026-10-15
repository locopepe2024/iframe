# s09 validation pass 1: frame evidence and assembly boundary

## Observed

- [Source evidence v2](../raw/2026-10-11-qiangfa-cut-poc/qiangfa2-gray-full/s09-action-evidence-v2.md) corrected two v1 statements at local frame 65 / original frame 1150: the body has recovered toward upright, and the red-tasseled end is at image **left**, not right. At frame 75 it is visible at image right; at frame 87 the shaft is high diagonal. The route between these samples remains uncertain. The cut at local frame 112 is a separate view.
- Original source SHA-256 matches the trial manifest. The 592x1280 original is a screen recording, while the 592x336 motion reference excludes its player UI. This distinguishes the original container from the cropped visual reference; UI in the baseline output is still a generated-output defect against the submitted motion clip.
- Real s09 v2 H3 output SHA-256 `db2523685555076ad069dc1e6efa7d53e036ca9b4a1d63d05a8b13dac0516e39` probes as 90 frames / 24 fps / **3.750 s**, with an audio stream despite `generate_audio=false`. The source motion is 120 frames / 30 fps / **4.000 s**.
- Calling the production service's `_probe_assembly_media` on that exact output returned `{"duration": 3.75, "audio_streams": 1}`. Its 4-second guard evaluates `3.75 + 0.02 < 4.0` as true. The existing short-output rejection and successful-crop tests both passed (2 selected tests). This verifies the duration guard with the real file plus a synthetic product-task test, not a full product assembly task using the real output.
- The historical `manifest.json` entry for s09 says `use_output_frames: [0,120]` even though the generated file has only 90 frames. That interval is planning/stale metadata, not a valid output-frame slice. The manifest's source interval `[1085,1205)` remains separately corroborated.
- The product generation plan permits integer H3 requests of 4–15 seconds (`service.py:756-758`), while its catalog lists 5 seconds as the default (`config/model_catalog/families/uniart.yaml`). Requesting 5 seconds is technically permitted for a 4-second shot; no observed 5-second output in this trial proves its delivered duration or motion timing.

## Direct implication

Do not send the current s09 v2 output into a 4-second product shot: its visual motion fails prior review and the current assembler would reject its duration. Correct frame-65 annotations and output-frame metadata before constructing the next prompt or comparing frame positions. A normalized time comparison remains a review aid; it is not an assembly retime.

## Not yet proven

- Exact failure location in an end-to-end real-output assembly task has not been captured. The duration guard is deterministic at the observed values, but surrounding project/task state may add earlier blockers.
- The extra audio stream does not prove audible content. Under silent assembly policy the current FFmpeg command selects video and `-an`; this run did not audit the stream's amplitude or downstream policy handling.
- Which intervention fixes action phase or prop geometry remains open. The existing v3 tail-hold trial did not fix the deep fold, but its prompt still required a cut absent from that input.
- GVHMR/DPVO is a separate optional 3D branch with no validated camera trajectory for this source; it supplies no s09 acceptance evidence yet.

## What would verify it next

1. Snapshot the corrected s09 annotation and prompt with hashes. Use a single-view reference containing the deep fold and recovery, with prompt text consistent with that reference; keep the target identity and clean-frame constraints fixed. The existing tail-hold clip may serve as a candidate, but its prompt must not request the removed second view.
2. Resolve the requested-versus-delivered duration contract before another paid run. A 5-second request is an allowed candidate for a 4-second shot, but requires an actual output-length probe and normal-speed phase review; the provider might still return a shorter or differently paced result. Recheck output-frame bounds and audio policy from the actual file rather than trusting the manifest.
3. Only then run one controlled candidate. Compare source and output by deep-fold, recovery, high diagonal, extension and cut-side events plus normal-speed playback; separately score person, spear coherence and UI. Do not expand to a full batch on a prompt-only improvement.

The current result is **stop for generation/assembly promotion** and **go for correcting the evidence and duration contract**.
