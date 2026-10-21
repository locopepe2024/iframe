# world landmarks 到 pinned rig 的隔离重定向对照

2026-10-22。只读隔离实验；没有修改主 builder、提取器、renderer、rig 或服务，没有把候选输出送入 H3。

## Observed

- 输入是同源 world sidecar、旧 image track、PTS 前段拟合出的弱透视 3×2 basis。通过右手补轴并映射到 renderer 目标镜头方向，代数投影闭环误差 3.33e-16，旋转行列式 +1。world target track 共28个唯一源帧，源1/17/23/29/41/55均存在。[world target track](../raw/2026-10-22-world-target/world-target-track.json)
- 在 pinned rig 上使用 world 方向代理、关闭骨盆、own-basis、root/yaw 冻结为同一旧 baseline，重新求解子骨。Blender 4.5.9 的方向残差均为0°，renderer 重导入差为0px；说明候选输入被正确执行和序列化。
- 与同 rig、同 root、同 own-basis 的 no_pelvis_own_basis_root 对照，12关节平均投影误差如下：

| 源帧 | 旧 proxy 方向 | world 方向候选 | 变化 |
| ---: | ---: | ---: | ---: |
| 1 | 12.53 px | 25.11 px | +12.58 |
| 17 | 17.26 px | 24.86 px | +7.60 |
| 23 | 13.31 px | 23.26 px | +9.94 |
| 29 | 21.98 px | 27.81 px | +5.83 |
| 41 | 16.90 px | 22.55 px | +5.65 |
| 55 | 24.27 px | 25.71 px | +1.44 |

- world 候选在源1/17/23/29/41/55的双踝平均误差分别为45.00/49.95/44.46/55.13/45.50/56.54px；旧对照为9.59/13.44/3.72/25.19/21.75/27.23px。髋点误差与旧对照相同，因为这次冻结了root且上腿骨头位置由父层决定；踝端点显著恶化。
- world 候选的肩误差也没有改善：源17左右肩为8.31/11.99px，源23为7.92/15.87px；输入方向虽已被 rig 精确执行，末端投影仍由深度、骨长、父链和目标镜头共同决定。[Blender报告](../raw/2026-10-22-world-target/report.json)。独立复核确认六个事件帧的全身均值和双踝均值都高于旧对照，且 root/yaw逐值冻结、回导误差<0.001px。[逐帧复核](../raw/2026-10-22-world-target/comparison.json)

## Direct implication

“把 pose_landmarks 换成 pose_world_landmarks”在当前未标定的 world→目标镜头映射下不能作为修复；六个事件帧全部比旧 proxy 对照差，尤其是脚踝。它排除了一个简单的接口执行错误：候选方向和序列化都正确，误差来自候选姿态/坐标映射与目标投影契约，而不是 renderer 丢四元数。

这也不证明 MediaPipe world landmarks 本身无用。当前映射使用同一模型输出拟合的弱透视方向，没有源相机内参、人物尺度、绝对深度或目标 rig 的身体比例校准；候选失败不能被归因为 world 坐标“错误”。

## Not yet proven

- 尚未比较 world 姿态的完整旋转、透视相机拟合、绝对根深度或目标 rig 骨长校准；本轮冻结 root/yaw，只测方向候选。
- source frame 55 后段转身、地面、鞋底代理与遮挡仍未通过。world 与 image 的同源拟合残差约10px量级，不能作为独立真值。
- world 输出的轴向语义、训练尺度和目标 rig 身体轴仍需在带相机内参/人体模型的源人体层验证；不能从本轮恶化推断单目深度是唯一主因。

## Hypotheses

最可能的候选问题是 world 相对人体坐标被映射到目标镜头时缺少透视深度和目标角色比例，导致方向虽执行准确、端点投影尤其是踝端点失配。另一可能是 world 输出的全身姿态与 image 输出在遮挡/脚部语义上存在不同模型偏差。两者都需要源人体层对照。

## What would verify it

下一步不再直接替换字段：在源人体层用显式相机内参、人体尺度和时序相机候选拟合 world landmarks，再把同一相机空间姿态投影到目标镜头；同时记录每关节深度、骨长和可见性。只有源人体重投影通过后，才把目标 rig 的 rest/身体轴和鞋底代理点接入。脚接触仍需独立的支持段与地面证据。

本轮命令由 recreation2_world_target_track.py 和扩展的 recreation2_rig_space_probe.py 完成；目标rig方向残差和renderer重导入检查通过，语法/JSON/diff检查通过。候选输出仅作为诊断 artifact。
