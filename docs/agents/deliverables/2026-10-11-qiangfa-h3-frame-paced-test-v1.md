# 枪法 H3：源片帧点约束与同 seed 对照

## Observed

- 对照来自源片 A `[90,210)`，30 fps，共 4 秒。连续检查源片帧 110–161 的分组记录见[帧审核](../raw/2026-10-11-qiangfa-cut-poc/shot-a-jump-4-source-frame-audit-v1.md)。源片局部约 0.73–0.97 秒扫杆与转身，约 1.12 秒双脚已离地，约 2.00 秒已低身且红缨端贴近画面左侧地面。手部和右侧枪身部分受录屏按钮、运动模糊遮挡。
- 本轮两条 `minimax-h3-vip` / `reference2video` 使用同一人物图、同一四秒视频、720p、9:16、`generate_audio=false`、`seed=20261011`。基线复用上轮[知识提示词](../raw/2026-10-11-qiangfa-cut-poc/shot-a-jump-4-h3-knowledge-v1-prompt.md)，含 2.000 秒目标切点；新试验用[逐帧节拍提示词](../raw/2026-10-11-qiangfa-cut-poc/shot-a-jump-4-h3-frame-paced-v1-prompt.md)，改为一个连续镜头并加入源片姿态时间锚点。任务分别为 `task_P4U6eKD7mUiJtehzTiFR4l9ZrxWO5yRE`、`task_QAEj2nSgR0UjQreO7gIzyxq6S7jVhv9R`；输入哈希、提示词、参数及输出哈希见各自[基线记录](../raw/2026-10-11-qiangfa-cut-poc/shot-a-jump-4-h3-seed-control-v1-generation.json)和[新试验记录](../raw/2026-10-11-qiangfa-cut-poc/shot-a-jump-4-h3-frame-paced-v1-generation.json)。
- 两条请求均完成并下载。[基线视频](../raw/2026-10-11-qiangfa-cut-poc/shot-a-jump-4-h3-seed-control-v1-silent.mp4)与[新试验视频](../raw/2026-10-11-qiangfa-cut-poc/shot-a-jump-4-h3-frame-paced-v1-silent.mp4)均为 768x1344、24 fps、90 帧、实际 3.750 秒。两条原始返回仍含音轨，静音副本已移除音轨。
- [0.5 秒全段图](../raw/2026-10-11-qiangfa-cut-poc/shot-a-jump-4-h3-frame-paced-v1-overview.png)、[0.25 秒关键段图](../raw/2026-10-11-qiangfa-cut-poc/shot-a-jump-4-h3-frame-paced-v1-critical.png)及[0.125 秒转段图](../raw/2026-10-11-qiangfa-cut-poc/shot-a-jump-4-h3-frame-paced-v1-transition.png)均按源片、同 seed 基线、新试验排列。基线约 1.75 秒才明显腾空，2.38 秒仍在空中；新试验约 1.25 秒腾空，2.125 秒仍在空中，2.50 秒采样已低身。源片约 1.12 秒腾空、2.00 秒已低身。以上为采样帧可见状态，不是逐帧自动测量的精确起落帧。
- 新试验在 1.00 秒原尺寸帧中，身体前倾而枪杆大段被运动模糊或身体遮住；2.125 秒帧仍呈腾空横枪姿态。稀疏采样中未见清楚的刚性枪杆穿透头颈实体，但遮挡使全序列无碰撞结论无法成立。

## Direct implication

新试验比同 seed 基线更早进入腾空姿态，起跳采样更接近源片；它仍延长空中阶段，低位落点比源片晚约 0.25–0.50 秒量级，扫、转身和枪杆路径没有达到逐帧复刻。不能据此批量生成或拼接整部 44.8 秒素材。两条输出均比请求短 0.250 秒，后续拼接必须按实际帧数处理。

## Not yet proven

- H3 对相同 seed 是否跨任务完全确定；本轮每种提示词仅运行一次。
- 改善来自具体哪一处文字：新提示词同时改变了镜头切点、动作时间锚点、节拍细节和空间描述。
- 未被遮挡的手部握点连续性、枪杆与头颈在所有帧的深度关系，以及低位动作是否构成规范“扎枪”。
- UniArt H3 当前 SKU 支持在同一次 `reference2video` 中加入中间帧或姿态条件；本地 wrapper 的通用字段不能证明该组合被 provider 接受或生效。

## What would verify it

如继续 H3 测试，可先做单变量、重复 seed 的小样本：保持同一镜头结构，只改变一个时间锚点，按源片和输出逐帧记录双脚接地、枪尖位置及头颈遮挡。若目标仍是严格逐帧复刻，应先取得可验证的中间姿态/逐帧控制 provider 契约，再用同一四秒窗口作验收；当前 H3 文本加参考视频路径不足以证明该控制能力。
