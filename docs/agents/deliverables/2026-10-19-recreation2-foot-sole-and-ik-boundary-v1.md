# recreation2 鞋底代理点与成熟 IK 接入边界

2026-10-19。本轮只读检查 pinned rig，并在无骨盆、含 root yaw 的 bundle 上做局部 IK 诊断；没有修改主 builder 或发布配置。

## Observed

- 脚部几何位于 `white-model-neutral-female-03`。左右脚可由 `DEF_foot_{l/r}`、`toe_{l/r}`、`toe_attachment_{l/r}` 蒙皮组筛选。
- 在静止姿态中，网格最低点带的鞋底代理点与 `foot_l/r` 骨头头部的相对偏移约为：
  - 左：`(+0.0149, -0.0867, -0.0551)` 米
  - 右：`(-0.0149, -0.0867, -0.0551)` 米
- 因此脚骨头不是鞋底接触点；直接把 foot bone head 的世界 Z 固定到地面会产生约 5.5 cm 的系统偏差。
- 以网格最低点作为代理后，既有 bundle 的选帧鞋底最低点仍明显变化：输出帧 1/20/24/28/37/48 的左脚约为 `0.103/0.108/0.165/0.068/0.003/0.205` 米。第 37 帧左右脚约 `0.003/-0.004` 米，说明该帧更接近当前 rig 的地面参考。
- 直接给 `ankle_l/r` 加 Blender IK constraint、把目标粗略放在“当前踝端点 + 鞋底高度修正”上，没有稳定命中鞋底目标；这是末端骨选择、pole vector 和目标姿态未校准的诊断结果，不是 IK 算法失效。

## Direct implication

- **成熟算法存在：** 支持脚检测、地面平面拟合、two-bone IK/FABRIK、pole vector、接触进入/离开平滑和 foot locking 都是标准做法。Blender IK 可承载局部求解。
- 本项目缺的不是 IK 求解器，而是三个输入契约：真实鞋底点、支持脚时段、与 rig 轴一致的末端目标/极向量。
- 脚接触不能只约束 root z；需要以鞋底代理点作为末端目标，用局部 IK 调整大腿/小腿，并让摆动脚保持自由。

## Not yet proven

- 网格最低点带是鞋底的几何代理，不等于视频中真实受力点；网格脚掌可能有厚度、弧度和透视遮挡。
- 当前地面高度只是 rig 内部参考，源视频的舞台平面尚未恢复为三维平面。
- 直接使用 Blender 的 ankle 末端和默认 pole vector 尚未通过目标保持测试。

## What would verify it

1. 用脚底候选顶点的稳健分位数，而不是单个最低顶点，定义左右鞋底接触点和脚底法向。
2. 对每个支持段，以源画面踝点速度、鞋底高度和水平速度联合判断支持脚；接触进入/退出使用权重渐变。
3. 选定 `foot` 或 `toe` 作为 IK 末端，显式设置 pole target 和 foot rotation；先做静止姿态目标保持测试，再跑源 1、17、23、29、41、55 帧。
4. 同时报告鞋底点误差、12 关节投影误差和摆动脚误差；若只改善鞋底而整体变差，不提升为主线方案。

产物：[鞋底代理点报告](../raw/2026-10-19-rig-space-calibration/foot-sole-report.json) · [鞋底探针](../tools/recreation2_foot_sole_probe.py) · [前一轮接触隔离](2026-10-19-recreation2-torso-contact-isolation-v1.md)
