# 枪术知识提示词：四秒 H3 对照

## Observed

- 同一人物图 SHA-256 `43c2a7db056c523024c916423f13ad32c093c8410abbbee9c3cef8e0d12aefb8`、同一源片四秒窗口 `[90,210)`，提交相同的 `minimax-h3-vip` / `reference2video` / 720p / 9:16 / 4 秒 / 2 秒目标切点。旧版任务 `task_KOezIc8H3t4f8xXzncgU2sqOSEC6kJJ6`，知识提示词任务 `task_yqshwLdWUIqxKEi95xrYgXBRwxSFMWdz`。两次没有固定相同随机种子。
- 新版提示词依据私有知识集合 `b8170831-742e-493b-ab5e-96929d74e9bf` 检索的官方扎枪定义和项目动作/几何观察编写。完整输入在[提示词](../raw/2026-10-11-qiangfa-cut-poc/shot-a-jump-4-h3-knowledge-v1-prompt.md)；所用 unit/revision/locator 在[来源清单](../raw/2026-10-11-qiangfa-cut-poc/shot-a-jump-4-h3-knowledge-v1-sources.json)。没有把源片“扫”认定为官方拦、拿或舞花枪，也没有断言源片完成规则要求的后手接触前手。
- 新版已完成并下载为[原始视频](../raw/2026-10-11-qiangfa-cut-poc/shot-a-jump-4-h3-knowledge-v1-replacement.mp4)，SHA-256 `8e58bbde59cf86b9952f9798da60624857670d05b791860b2f3e4a080336d1c3`；[无音轨副本](../raw/2026-10-11-qiangfa-cut-poc/shot-a-jump-4-h3-knowledge-v1-silent.mp4) SHA-256 `ecd9a2310305bcc298e28770e96ff788142d377c234e3351a01daaa21fc7b878`。和旧版一样，它返回 90 帧、24 fps、3.750 秒，并在 `generate_audio=false` 时仍附带 AAC 音轨。
- [全段 0.5 秒采样](../raw/2026-10-11-qiangfa-cut-poc/shot-a-jump-4-h3-knowledge-v1-overview.png)与[关键段 0.25 秒采样](../raw/2026-10-11-qiangfa-cut-poc/shot-a-jump-4-h3-knowledge-v1-critical.png)按源片、旧版、新版排列。源片在约 1.0–1.75 秒出现腾空姿态、约 2.0 秒已低身伸枪；旧版在 2.0 秒采样仍腾空，新版在 1.5 秒腾空、2.0 秒采样已低身伸枪。新版 0.75 秒枪杆高举，与源片当时的较低扫动不同；扫与转身轨迹仍未复刻。
- 新版原尺寸 0.75、1.25、1.50 秒抽帧未显示明确的枪杆穿过头颈实体；局部遮挡和运动模糊仍存在。稀疏帧不能证明全片、所有握点或枪杆路径正确。

## Direct implication

这一条新版在所选采样点上的腾空结束与低身伸枪时机比旧版更接近源片，但没有满足逐帧复刻验收。四个动作在约 1 秒内发生，应描述为连续的快速节拍；本试验保留两段结构，并未验证“四秒四个实际剪切镜头”。知识检索提供的是可追溯术语和空间检查项，不能直接替代中间帧约束。

## Not yet proven

- 没有相同随机种子或重复生成，无法把时序变化归因于知识库或提示词；两个提示词同时改变了动作动词、节拍和头颈约束。
- 1–2 秒内每一个扫、转身、起跳、落地、扎的准确边界，及全部 90 帧的双手握点/头颈碰撞状态。
- 把当前方法扩展到完整 44.8 秒素材的镜头连续性。

## Next test

先用源片逐帧标注枪尖、枪把、双手和脚接地点，明确中间关键帧；下一轮保持人物图与时长不变，尝试增加中间帧/姿态条件。如果只改文字，需要固定随机种子并重复多次生成，按动作时序和几何错误率评分。当前输出不应批量拼接成全片。
