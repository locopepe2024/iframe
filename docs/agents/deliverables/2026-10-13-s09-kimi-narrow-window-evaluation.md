# s09 Kimi narrow-window video parse

## Observed

- Submitted [the 2-second clip](../raw/2026-10-11-qiangfa-cut-poc/qiangfa2-gray-full/s09-kimi-deep-bend-frames-30-89.mp4) covering original s09 local frames `[30,90)` (original s09 time 1.0–3.0 s), 60 frames at 30 fps, to UniArt request model `kimi-k3-video`. It contains the deep bend, rise and lifted spear. The [probe record](../raw/2026-10-11-qiangfa-cut-poc/qiangfa2-gray-full/s09-kimi-k3-video-narrow-probe.json) returned HTTP 200, response model `kimi-k3`, and structured text. The input was re-encoded to make the exact frame window; it is not byte-identical to the corresponding part of the original file.
- Kimi correctly stated the local-to-original mapping `original frame = 30 + local time × 30`. Its five requested time points correspond to original frames 30, 45, 60, 75 and 87. The [frame check sheet](../raw/2026-10-11-qiangfa-cut-poc/qiangfa2-gray-full/s09-kimi-narrow-frame-check.png) shows those frames in that order.
- At original frame 30, Kimi broadly described a lateral spear and forward lean. Its “face toward camera” and wide stance are uncertain in the image.
- At frame 45, the source performer is deeply folded forward with the shaft spanning above the back. Kimi reported a relatively upright back-facing posture and tassel at upper left. That is a material pose error; the visible left end is pale, and the red end is not clear in this frame.
- At frame 60, Kimi reported a forward bend and blurred shaft. The frame does show a low torso and lateral/diagonal shaft, so the broad phase is supported. It claimed the red tassel is absent; that is compatible with the sampled frame.
- At frame 75, Kimi reported turning with a diagonal shaft, broadly supported. Its claim of a red blur at image left is not supported by the exact frame; the red end is near the body toward image right.
- At frame 87, the source shaft is raised diagonally toward image upper right, with the red end high. Kimi reported a nearly horizontal shaft at chest height, red end at image right and a pause. Only the red-end side is supported; shaft angle and pause are wrong or unproven.
- Kimi did **not** confirm a hard cut within this 2-second window. The previously confirmed s09 hard cut is at local frame 112, outside this clip. Its refusal to promote color separation or a thin border into a certain cut is appropriately cautious here.

## Direct implication

Narrowing s09 to the deep-bend window did not make Kimi's requested time-point descriptions reliable enough for action annotation. It found the broad bend-and-rise sequence and handled frame mapping, but missed the depth of the bend at frame 45 and the high spear angle at frame 87. Those are precisely the constraints needed for generation. Kimi remains useful for proposing candidate phases and uncertain review targets, followed by source-frame verification.

## Not yet proven

- This single narrow-window output is not a model accuracy estimate. The model's internal video sampling and its interpretation of requested timestamps are not exposed. Its answer's claim of “7–8 sampled frames per second” is self-reported and unverified.
- The request model name `kimi-k3-video` and response model name `kimi-k3` differ. No selected upstream channel/model evidence was collected.
- No H3 generation was run from this narrow parse, so it does not establish a generation improvement.

## What would verify it

For a usable s09 annotation, keep the existing source-frame evidence table as authority and require a human or frame-level review for every timing, pose and prop direction promoted from Kimi. A stronger Kimi test would supply explicit stills with frame labels for frames 30, 45, 60, 75 and 87 and evaluate whether the model can correct the two decisive errors; that would test frame-grounded image interpretation rather than native video timing.
