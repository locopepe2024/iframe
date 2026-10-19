# 复刻动作恢复 Spec Summary v1

日期：2026-10-14。范围：单人视频到人体动作、目标骨架和复刻参考资产的候选链路。本文记录验证边界，不将研究试验视为已上线能力。

## Observed

- GVHMR 官方代码中的 `-s` / `--static_cam` 跳过视觉里程计。动态相机模式（不加 `-s`）默认使用 SimpleVO；只有显式设置 `--use_dpvo` 才调用 DPVO。官方 README 的旧句子称动态相机由 DPVO 估计，但同一 README 的更新说明及 `tools/demo/demo.py` 的分支表明当前默认已改为 SimpleVO。依赖名称是 **DPVO**，不是 PDVO。代码来源：GVHMR 上游版本 `ee960bb6e2ea2d381aa97f08e9b71ef320b624b1`，`tools/demo/demo.py`、`hmr4d/utils/preproc/slam.py`。
- [本地 GVHMR CPU 研究记录](../../../gvhmr-cpu-validation/CPU-VALIDATION.md)中的 90 帧预处理和 SMPL-X 参数解码能够执行。该测试源片相机可见移动，SimpleVO 在默认参数下未得到有效相机轨迹；改用“假定静态相机”的结果标记 `world_trajectory_validated=false`。这些运行事实不构成动作精度证明。
- [iFrame 骨架方向验证](2026-09-30-director3d-motion-pipeline-bundle-v1.md)发现另一层独立误差：早期 Blender 白模映射在测量肢体上达到 52–167 度方向误差。即使上游 SMPL-X 姿态有效，下游骨架转换仍需单独验收。
- [HighTorque-Robotics 的整合仓库](https://github.com/HighTorque-Robotics/Mini_Pi_Plus_GVHMR-and-GMR) README 描述 GVHMR 视频姿态提取接 GMR 机器人动作重定向/BVH，并以派+动作训练为用途。该 README 没有给出 Mixamo 角色、GLB、Blender 插件或源帧动作精度的验收证据。

### 2026-10-15 SimpleVO 失败边界复测

- 在同一研究素材 SHA-256 `49c73ccaaa2bf36d89c234006417320f7ffd5f9c5d58e6eafd227e38d4fa8602` 的 71→72 帧对，重复运行独立诊断。默认设置的[记录](../agents/raw/2026-10-15-gvhmr-vo-pair71-default.json)找到 340 个全画面匹配、324 个 OpenCV essential-matrix 内点，却由 pycolmap 返回配置值 `7 = WATERMARK`，没有相对位姿。限定背景时也返回 `WATERMARK`、没有位姿。
- 仅关闭该诊断中的 `detect_watermark` 后，[同帧记录](../agents/raw/2026-10-15-gvhmr-vo-pair71-no-watermark.json)在两种匹配范围均返回配置值 `4 = PLANAR` 和相对位姿。配置值名称用该研究环境的 `pycolmap.TwoViewGeometryConfiguration` 枚举核对。此前保存的 11 对抽样诊断也显示关闭检查后均可返回位姿；本次只重复了 71→72 帧对。
- 随后对同一 90 帧素材的全部 89 个相邻帧对进行了诊断，保留[默认设置原始结果](../agents/raw/2026-10-15-gvhmr-vo-allpairs-default.json)和[关闭检查的原始结果](../agents/raw/2026-10-15-gvhmr-vo-allpairs-no-watermark.json)。全画面匹配下，有效相对位姿从 `88/89` 变为 `89/89`，默认唯一失败仍是 71→72；默认配置分布为 `CALIBRATED 77、PLANAR 11、WATERMARK 1`。限定背景匹配下，有效位姿从 `52/89` 变为 `81/89`；剩余 8 个失败包含匹配点不足和退化分类。逐帧对诊断没有把位姿积分为相机轨迹，也没有评估累计漂移或回投精度。
- **直接推论：** 在 71→72 失败帧对，缺少匹配点不是充分解释；`detect_watermark` 设置影响求解器是否交付位姿。**尚未证明：** 关闭检查可产生可信的全段相机轨迹。`PLANAR` 提醒场景几何可能使平移难判，背景限定匹配仍有失败，且 RANSAC 有运行波动；也不能由 SimpleVO 帧对结果推断 DPVO 的效果。

### 2026-10-15 完整轨迹探针

- 用[隔离诊断脚本](../agents/tools/gvhmr_simplevo_trajectory_probe.py)复用 SimpleVO 的缩放/采样、SIFT、pycolmap 与 `T_delta @ T_w2c` 积分；该脚本只记录诊断，不改上游推理或产品代码。[默认参数结果](../agents/raw/2026-10-15-gvhmr-trajectory-0p5-step8-default.json)和[关闭 watermark 结果](../agents/raw/2026-10-15-gvhmr-trajectory-0p5-step8-no-watermark.json)都在采样帧 24→32 停止：仅 4 个匹配、`DEGENERATE`，无相对位姿。在此前 0→8、16→24 两步中报告约 91° 的旋转。由此可见 watermark 设置不是默认稀疏采样失败的充分修复。
- [原尺寸逐帧默认结果](../agents/raw/2026-10-15-gvhmr-trajectory-1p0-step1-default.json)在 71→72 停止，配置为 `WATERMARK`；[关闭检查结果](../agents/raw/2026-10-15-gvhmr-trajectory-1p0-step1-no-watermark.json)积累了全部 89 步，末帧相对首帧旋转约 20.46°。但是 17→18 和 18→19 单帧旋转分别达到 12.54°、30.44°，远高于本次估计的 1.23° 中位数。原始[16–20 帧联系表](../agents/raw/2026-10-15-gvhmr-frames16-20.png)可见人和器械剧烈运动；仅凭该抽样不能证明镜头真的发生 30° 转动。17→18 的全画面匹配仅 18 个，背景限定只有 8 个且退化，提示该处估计不稳。
- **直接推论：** 更密的帧采样加关闭 watermark 检查能让这段测试完成位姿积分，但产生了需复核的局部旋转突变。**尚未证明：** 该轨迹的相机旋转、世界位移或人体动作准确。脚本的 `completed` 仅表示每对采样帧返回了位姿；单目相对平移没有可用的公制尺度，也未通过背景回投或独立相机真值验收。

## Direct implication

### 2026-10-19 CozyClay / media 白模与源 PTS 验证

- media Blender 4.5.9 已将合成 24 帧 bundle 和真实轨迹 31 key bundle 分别渲染为白模 MP4。真实轨迹输出为 48 帧、24 fps、2 秒，证明渲染链路可执行，不证明源动作精度。[运行证据](../agents/deliverables/2026-10-19-real-motion-track-media-white-model-v1.md)
- CozyClay 浏览器编译/导出 48 帧已通过；固定脚位的诊断 spec 可达 `qa.ok=true`，但从真实轨迹直接映射脚踝/根位置的 spec 有 168 个 QA 问题。空间代理校准将数量降至 10，但修改了源脚步，不能作为保真结果。[QA 隔离对照](../agents/deliverables/2026-10-19-cozyclay-real-track-qa-isolation-v1.md)
- 对 `recreation2-final120.json` 对应原片复核后发现：轨迹时间戳使用平均 FPS，源第 11→12 帧实际 PTS 跨 0.271265 秒；源第 61 帧 PTS 为 2.170123 秒，而轨迹记录 1.955224 秒。旧 48 帧白模把约 2.17 秒源内容压成 2.0 秒，不能用于节奏验收。[源帧证据与脚部阶段](../agents/deliverables/2026-10-19-recreation2-source-pts-foot-evidence-v1.md)
- 之后任何动作 bundle 的时间主键须为源视频逐帧 PTS，并同时保留源帧号；平均 FPS 只能作视频总体统计，不能代替可变时间间隔。接触约束须按源帧阶段切换，不能全段固定双脚。
- 已用源 PTS 对齐的前 2 秒重新输出 48 帧 media 白模；长停顿在时间线上得到保留，但白模仍明显漂浮、朝向与源片不符。时间轴修复通过工程验证，空间动作重定向仍失败；当前不得送入 H3 作为合格白模参考。[PTS 对照和新产物](../agents/deliverables/2026-10-19-recreation2-source-pts-foot-evidence-v1.md)
- 对同一 `recreation2` 源片跟踪三处舞台背景灯位：已测的源第 1、11、17、23 帧相对首帧无整数像素位移，第 55 帧（PTS 1.959139 秒）在原画幅出现约 +64、+42、+2 像素的横向位移及 +14–18 像素的纵向位移。三点横向位置符合二维缩小/重构图代理，但不能由此断定真实三维相机移动或恢复公制深度；固定相机全段假设不宜直接沿用。首帧白模已明显出现朝向和肢体姿态失配，因此后段背景运动并非全部失败的充分解释。[背景位移与首帧隔离报告](../agents/deliverables/2026-10-19-recreation2-background-motion-and-first-frame-v1.md)
- 对相同源轨迹和 pinned rig 做骨盆朝向开关消融：原 PTS bundle 可由 `--enable-pelvis-orientation` 逐值重现；关闭该开关并**重算所有子骨骼**后，12 个语义关节的首帧平均投影误差由 37.62 降至 12.76 px，首次抬脚第 17/23 帧由 48.99/44.56 降至 17.57/14.04 px。第 55 帧仍有 41.72 px，落脚、地面和后段转身未通过；这是诊断基线，不是 H3 合格白模。不能仅删除旧 bundle 的骨盆四元数，因子骨骼以旧父空间求解。[骨盆朝向隔离报告与 2 秒诊断视频](../agents/deliverables/2026-10-19-recreation2-pelvis-orientation-isolation-v1.md)
- 同一隔离进一步发现现有 `pelvis_target` 的 `(right, forward, up)` 三列行列式为 −1，目标矩阵是反射，不能由四元数准确表达。仅改叉积使行列式 +1 后，首帧平均关节误差反而为 47.89 px，说明还需核对 rig 静止轴、前向和父空间变换；不能将单一叉积修改当成已验证的修复。[逐轴诊断](../agents/deliverables/2026-10-19-recreation2-pelvis-orientation-isolation-v1.md)
- 后续七组 rig 空间隔离已确认骨盆骨轴与静止身体轴不重合，并发现求解时未包含渲染 root yaw。仅纳入 root 后，源17/23/29帧平均误差为 15.74/12.25/18.46 px；完整身体/骨盆与子骨基底/root 校准在源55帧为 19.35 px，但前四帧没有优于无骨盆基线。全七组 bundle 重导入投影差为 0；旋转方向对齐不等于关节位置或鞋底接触合格。主 builder 未改，仍不得送 H3。[身体轴、骨盆与 root 空间实验](../agents/deliverables/2026-10-19-recreation2-rig-space-calibration-v1.md)
- 躯干分离与接触约束隔离显示：水平骨盆目标改善后段但使前四帧变差；支持脚世界高度或单点像素 y 锁定会改善指定脚，却把另一只脚和全身投影推偏。脚接触需要鞋底点、地面证据和局部 IK/根高度联合求解，不能只平移 root。[躯干与脚接触隔离](../agents/deliverables/2026-10-19-recreation2-torso-contact-isolation-v1.md)
- pinned rig 只读标定发现网格鞋底代理点与 `foot_l/r` 骨头头部相差约 5.5 cm；直接把骨头 head 当接触点会产生系统偏差。成熟 two-bone IK 可用，但末端骨、pole vector、支持段和鞋底目标仍需标定；粗略 IK 目标保持诊断未命中，不应当作算法失败或生产修复。[鞋底与 IK 接入边界](../agents/deliverables/2026-10-19-recreation2-foot-sole-and-ik-boundary-v1.md)
- 后续更正：上项 5.5 cm 是未经公制标定的0.055 Blender units静止世界Z偏移；旧IK链没有覆盖大腿且跨帧累积约束。改用固定网格patch和直接hip/knee/ankle两节腿后，六帧零位移、端点/骨长、上身/另一腿保持与renderer重导入测试通过。源29/41误差18.46/15.14→17.99/14.21 px，源23则12.25→13.42 px；求解几何通过，真实源接触和连续支持段仍未验收。[两节腿验证](../agents/deliverables/2026-10-19-recreation2-two-bone-ik-validation-v1.md)
- 连续段比较扩至28个源采样、29个PTS key及48输出帧，统一权重0/0.5/1预先固定。0.5将测试平面高度残差P95约减半，踝点中位数17.21→16.38 px，但踝点P95 36.37→36.83 px、全身中位数16.03→16.11 px。支持允许残余误差并用多指标容差验收，不支持直接“取中值即达标”；实际源地面与连续性仍待验证。[连续段容差基线](../agents/deliverables/2026-10-19-recreation2-sequence-tolerance-v1.md)
- 独立16帧鞋底复核保留整鞋/鞋缘/分离/不确定区别，源29不能直接锁双脚，源49–55也不能只凭屈膝断定整脚离地。输出28最大步长来自右腕52.36 px；对应源轨迹右腕二维仅9.74 px而proxy深度改变0.24930，尚未证明深度错误。输出33支持候选patch总水平速度3.179 units/s，root-only项0.466、局部项3.188（向量分解）；源支持踝二维仅动1.15 px。这些需单独诊断，不能靠中值权重或放宽误差阈值吸收。[接触取证与异常位移](../agents/deliverables/2026-10-19-recreation2-contact-evidence-spike-v1.md)

- XYZ契约审计确认现存提取器保存MediaPipe `pose_landmarks`，不是`pose_world_landmarks`；原始→标准化3786分量、标准化→切片1488分量逐值相等，无新增深度。官方定义X/Y按宽/高归一化，Z为髋相对且近似X尺度；builder却直接将差值求欧氏方向，并用髋均值Z估root深度。原片Y换成图宽基准因子为0.568149，但尚未验证补偿后的投影效果。未发现“重复加深度”证据；主链路未改。[XYZ输入契约与验证边界](../agents/deliverables/2026-10-19-recreation2-xyz-contract-v1.md)

复刻链路须把 `视频取证 → 相机轨迹 → GVHMR 原生人体重建 → 目标骨架重定向 → Blender/GLB 输出 → 源帧验收` 分层记录。GLB 能导入 Blender/Unity 只证明资产可用，不证明源动作、世界轨迹、脚接触或双手持枪关系准确。照片输入只提供单帧姿态线索，不能作为连续动作恢复的时间证据。

动态相机样本不得用 `-s` 的输出宣称世界空间轨迹合格。SimpleVO 失败时，应先检查相机估计条件，再在具备 DPVO/CUDA 环境时做同片对照；安装 DPVO 本身不等于轨迹正确。现有 CPU 验证未运行 DPVO。

## Not yet proven / Hypotheses

- DPVO 能否在当前移动镜头素材上稳定恢复相机旋转和轨迹，以及它是否改善 GVHMR 源帧对齐，尚无实测。
- 我们观察的白模误差有多少来自相机估计、GVHMR 本体、坐标变换或目标骨架重定向，尚未用同片分层实验归因。
- 外部 Mixamo/GLB/Blender 插件方案是否包含自动骨架校准、接触约束或可用于 iFrame 的授权，尚未核实。HighTorque 的机器人 GMR 流程不等同于 Mixamo 角色流程。

## What would verify it

1. 固定同一段带源帧/PTS、镜头移动标记及可见动作事件的短片；记录输入、模型权重、相机方案和输出哈希。另选确认为固定相机的短片作基线。
2. 下一步检查逐帧轨迹的背景特征回投/重投影与 17–19 帧旋转突变，并用独立固定相机基线量假旋转；不能用 89/89 位姿可用当作准确轨迹。对有剪辑的视频须先分镜，不能跨切点积分。具备 CUDA 环境时再跑 DPVO 同片对照。失败轨迹不能继续作为世界动作真值。
3. 在尚未重定向的 SMPL-X 上比较源帧姿态事件、人体朝向、关节回投和根轨迹；遮挡部位标为不可评。仅当该层合格，再将同一动作送入目标骨架。
4. 在目标角色及 Blender 重导入的 GLB 中，按相同帧/事件复核骨骼方向、脚地面关系、手与道具的可见接触、动作连续性；记录每层首次失配的位置。

和 [枪法_2 复刻验证计划](../agents/deliverables/2026-10-13-recreation-failure-dimensions-validation-plan-v1.md)的关系：本摘要是可选的 3D 动作恢复分支，不替代该计划中的源帧证据表、镜头切点与 H3 输出验收。
