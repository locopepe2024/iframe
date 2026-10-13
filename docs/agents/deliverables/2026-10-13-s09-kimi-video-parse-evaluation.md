# s09 Kimi video parsing evaluation

## Observed

- Tested the 4-second, 120-frame s09 motion clip (SHA-256 `2e4324bd6284878954323fbe9a6c86edd4c178c43cecc168385d44aad3dd2a3c`) through UniArt `POST /v1/chat/completions` with request model `kimi-k3-video`. The request carried the MP4 as `video_url: data:video/mp4;base64,...` and asked for timed visible evidence, candidate actions, candidate cuts and uncertainty. The [probe script](../raw/2026-10-11-qiangfa-cut-poc/s09_kimi_video_probe.py) and [successful response record](../raw/2026-10-11-qiangfa-cut-poc/qiangfa2-gray-full/s09-kimi-k3-video-probe-gzip-encoding.json) preserve the input hash and returned text without the encoded video or credentials.
- The successful request returned HTTP 200, JSON, `Content-Encoding: gzip`, and response model `kimi-k3`. Usage reported 2,411 prompt tokens and 4,869 completion tokens, including 3,306 reasoning tokens. The request name and returned model name differ. This establishes an accepted UniArt route and video-conditioned text response; it does not independently identify the actual upstream model or route configuration.
- The first probe returned HTTP 200 with unreadable compressed bytes in this Python environment. A retry requesting `identity` encoding timed out after 180 seconds. The final request explicitly accepted `gzip, deflate` and yielded readable JSON. The earlier two attempts did not produce usable analysis; they do not count as independent quality samples.
- Official Kimi vision documentation describes MP4 video input through `video_url`, including base64 input in its K2.6 quickstart and file upload with `ms://` IDs in its vision guide. The public documentation checked here did not list the UniArt route name `kimi-k3-video`; its naming is supported by the live UniArt request result, not by that documentation.

## Source-frame check

The [source evidence table](../raw/2026-10-11-qiangfa-cut-poc/qiangfa2-gray-full/s09-action-evidence-v1.md) and [seven exact local frames](../raw/2026-10-11-qiangfa-cut-poc/qiangfa2-gray-full/s09-kimi-frame-check.png) were used for this check. Columns are frames 0, 21, 39, 66, 81, 99 and 114 (0.0, 0.7, 1.3, 2.2, 2.7, 3.3 and 3.8 seconds).

| Kimi claim | Check against source | Evidence level |
|---|---|---|
| At 0.0 s, performer upright with shaft high and red end at image left | Supported by frame 0 | Runtime observation plus frame evidence |
| At 0.7 s, red tassel at image left | Frame 21 shows the red blur toward image right | Contradicted at specified frame |
| At 1.3 s, torso forward, spear near shoulder height | Frame 39 supports the deep forward bend and lateral shaft | Supported for posture; exact shoulder/neck relation uncertain |
| At 1.3 s, red tassel near the right shoulder and black top strip | Frame 39 does not support a distinct right-shoulder red tassel or a black top strip | Unsupported at specified frame |
| At 2.2 s, long shaft across front and red end left | Frame 66 broadly supports this | Supported in sampled frame |
| At 3.3 s, forward/lateral spear extension and red blur left | Frame 99 broadly supports this | Supported in sampled frame |
| At 3.8 s, low posture with red end up-left and RGB separation | Frame 114 supports the low pose, diagonal shaft, red end and visible color separation | Supported in sampled frame |
| Possible cuts near 1.0, 1.5 and 3.5-3.65 s | Scene-change scan found a strong exact transition at local frame 112 / 3.733 s. Earlier high scene scores at 0.9-1.8 s occur during large motion and changing sky; they do not establish hard cuts. | Candidate cut timing is inaccurate; early cuts unproven |

## Direct implication

Kimi provided useful **action recognition candidates** and identified some visible poses and uncertainty. Its timed claims contain errors, and its cut candidates miss the confirmed 3.733-second boundary. The output should be used to propose review targets; it is not a source-verified action annotation and should not be fed directly into H3 prompts as ground truth.

## Not yet proven

- The response does not prove frame-accurate access to all 120 frames. The model may sample keyframes internally; the exact sampling strategy and timestamp semantics are not exposed.
- The result is one successful video-conditioned call, not a reliability estimate. The `kimi-k3` response model field does not prove which upstream variant executed `kimi-k3-video`.
- This test does not show whether Kimi's candidate actions improve H3 generation. The previous H3 trials already show that a plausible action description can coexist with poor action-phase fidelity.

## What would verify it

For s09, provide Kimi's candidates alongside extracted frame IDs, then require frame-level review before promoting any phase, direction, contact point or cut into the action annotation. A follow-up quality test could ask about a narrow 1.0-2.0 s clip and compare its claims with consecutive source frames, while keeping the full-video result as a separate baseline. A route-level check should record the UniArt selected channel/upstream model if that distinction matters for model attribution.
