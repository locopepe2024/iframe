# 同源 MediaPipe world landmarks 伴随诊断

2026-10-21–22。使用原始视频、原提取器、同一 pose 模型与 MediaPipe 1.0.1，在隔离 sidecar 中只补存 pose_world_landmarks。没有覆盖旧 track，也没有接入 builder/rig/renderer。

## Observed

- 原视频 SHA256 为 6614a5f7afdc5dd7342058e99027f2f42eee19594dcfd90c46017ddcfce114c0；原提取器 SHA256 为 aba3f34ae3824533a8036cf73c3c5fc773dcca5c12d2b73f7c06a922df6e5546；pose 模型 SHA256 为 59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a。
- 120 个采样帧的目标 pose index、选择状态、候选数量和已有 image landmarks 均与旧轨迹一致；图像 landmarks 最大逐值差为 0。79 帧有完整目标 world landmarks，41 帧与旧轨迹一样没有目标检测。[配对运行报告](../raw/2026-10-21-world-companion-projection/run.json)
- 通过 ffprobe 将采样帧索引映射回源 PTS：track frame 1/17/23/29/55 的 PTS 为 0/0.783655/0.964499/1.145343/1.959139 秒。旧提取器内部仍使用平均 FPS 时间戳；world sidecar 继承这一推理时间戳，不能把它当成已用源 PTS 的时序推理。[PTS映射](../raw/2026-10-21-world-companion-projection/pts-map.json)
- 平均 FPS 时间戳与对应帧 PTS 的绝对差中位数/P90/最大值为0.054/0.223/0.267秒。单独用真实PTS重跑VIDEO模式后，120帧目标索引/状态完全相同；79个可检测帧的image landmarks和world XYZ也逐值相同，41个未检测帧在两次运行中都无输出。这表明本段提取姿态不受该时间戳输入变化影响；不能推广到其它素材或所有模型版本。[时序单变量对照](../raw/2026-10-21-world-companion-projection/timestamp-ablation.json)
- 用16个语义关节、图像visibility≥0.2做弱透视一致性诊断。共享三维朝向只在PTS≤1.898857s（track帧1–53）估计，之后固定；各帧独立尺度/二维平移。79帧加权RMSE中位数/P90/最大为10.56/14.58/21.58px。逐帧朝向另以共享朝向作为初始化、重估尺度与平移，逐帧残差被约束为不高于共享解；其RMSE中位/P90/最大为9.80/13.18/16.25px。朝向用局部坐标搜索，不能视为全局最优或真实相机。[投影一致性数值](../raw/2026-10-21-world-companion-projection/consistency.json)
- 事件采样点在固定首段朝向诊断中的帧RMSE：track frame 1/17/23/29/55分别为10.67/10.81/12.76/9.73/11.18px；逐帧自由朝向分别10.55/10.53/12.27/9.40/9.97px。它们不是目标rig投影误差，而是world输出与同帧image观测的几何一致性残差。
- 固定朝向下，track帧1–53 RMSE中位数/P90为10.79/12.84px；帧63之后为9.91/15.60px（48帧），后段中位数未升高。逐帧拟合朝向相对首段参考的偏角：帧1–53中位/P90 5.48°/7.60°，帧63之后4.82°/7.95°。PTS1.959–2.170秒背景运动证据窗仅4个世界姿态样本，共享RMSE中位10.60px、朝向偏角中位3.79°。这组弱透视拟合未显示该短窗有明显额外朝向偏转；也不能排除相机平移/缩放、人体转向或透视变化。
- 以ffprobe PTS替换平均FPS推算时间，独立重跑同一VIDEO提取器后，120帧目标选择、状态、image landmarks和可用world landmarks均逐值不变；79/79有world帧的XYZ最大差0。因此此素材上的模型输出差异不能归因于时间戳设置；但后续产物映射仍必须使用源PTS。精确对照见[PTS时序试验](../raw/2026-10-21-world-companion-projection/timestamp-ablation.json)。

## Direct implication

world landmarks 可以在不改变旧 image track 选择的情况下获得，并可作为独立的髋相对米制人体姿态候选。它不是把旧 XYZ 的语义改名：world 输出仍以髋为原点，不能直接提供舞台绝对 root、相机轨迹或地面高度。

world 与 image 的残差约 10 px 量级，说明同一模型的两个输出在这段视频上并非像素级互相可替换。把 world 字段直接送入现有 builder 不能被视作已验证修复；需要将其作为源人体候选，在相机模型和重投影目标下单独拟合/评估。

## Not yet proven

- 弱透视诊断没有标定焦距、主点、透视深度、镜头外参或畸变；固定朝向残差及朝向偏角均不能直接归因于相机运动，逐帧自由朝向也不能作为相机估计。
- world landmarks 是 MediaPipe 的模型估计，不是独立三维真值；残差还可能来自遮挡、骨架语义、模型尺度和图像观测噪声。
- 没有将 world 候选接入目标 rig，也没有测脚接触、root 轨迹、骨盆/胸廓朝向或 H3。原提取器的平均 FPS 时间戳问题仍存在。

## Hypotheses

如果大幅最佳朝向变化与背景特征运动或源镜头切换一致，未建模相机变化可能参与误差；如果固定镜头片段仍有类似变化，则模型姿态/深度与二维观测差异更可疑。当前数据只支持把这两个方向分开测试。

## What would verify it

先按源 PTS 与镜头阶段分组，在源人体层比较 world 候选、image 观测和显式透视相机拟合；报告共享相机与分段相机的重投影、相机旋转敏感性、遮挡/低置信关节。通过后才将同一 world 姿态送入 pinned rig，并分别验完整旋转、关节头、鞋底代理点和 root。不要用单一中值替代事件帧和接触验收。

工具：[world伴随补丁](../tools/recreation2_world_companion_patch.py)、[PTS映射](../tools/recreation2_world_pts_map.py)、[投影一致性](../tools/recreation2_world_projection_consistency.py)。完整 sidecar：[world.json](../raw/2026-10-21-world-companion-projection/world.json)。
