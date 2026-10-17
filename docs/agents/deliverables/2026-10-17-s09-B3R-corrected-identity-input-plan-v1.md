# s09 B3R：纠正人物图输入的受控对照

日期：2026-10-17。状态：离线准备完成，未提交新生成。

## Observed

- 用户指定目标图 `/Users/owen/Downloads/白模/枪法_4.png`（SHA-256 `1e26b489…`）是银发、眼镜、黑色中式外套人物。既有灰模全片流程使用其 768 宽版本 `qiangfa4-reference-768.png`（SHA-256 `ba4e1a55…`）。
- s09 A/B/B2/B3 记录中的人物图 SHA-256 都是 `43c2a7db…`，对应另一张 `枪法.png`。这与 B/B3 提示词和用户目标图不一致。
- B3 源视频 SHA-256 `2e4324bd…`、提示词 SHA-256 `91b5f36e…`、seed `20261011` 已冻结。B3 输出人物、枪几何、动作节奏和切点均未通过。

## Direct implication

B3R 只把 `reference_image` 换为 `qiangfa4-reference-768.png`；沿用 B3 的 `<Video 1>`、提示词、`minimax-h3-vip`、`reference2video`、4 秒、720p、16:9、静音与 seed。由此可以比较**修正人物输入**对输出的影响。枪端及时间线问题仍须独立验收；若 B3R 仍失败，不能据此判定正确人物图本身无效。

## Not yet proven

- 单独换为正确目标图能否让人物外观接近 `枪法_4`。
- 目标图改动是否会同时改变枪形、动作相位或切点。相同 seed 不保证完全确定性。

## What would verify it

已运行 `PYTHONPATH=. python3 docs/agents/raw/2026-10-11-qiangfa-cut-poc/s09_b3r_trial.py validate`，源视频、目标图和提示词哈希及 H3 结构检查通过。新生成若获授权，任务记录写入 `s09-label-ab-B3R-generation.json`，完成后按相同输出帧时间对照 B3；人物先比头发、眼镜、外套、裤鞋，动作、枪端、切点分开评分。`s09_b3r_trial.py submit` 有任务记录存在检查，避免重复提交。
