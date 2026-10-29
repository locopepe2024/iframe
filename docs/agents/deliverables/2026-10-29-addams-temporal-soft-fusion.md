# 用户选择后的二维时序软融合

## Observed

已将18项用户决策按语义分流：`joint_center`仅进入姿态候选，`shoe_proxy`仅进入脚底候选；坐标按用户选择的Y/M/C读取。对第46–65帧做线性插值诊断，不写Blender、不推断深度、不推断接触。

| 分组/部位 | 选中观测数 | 当前判断 |
|---|---:|---|
| joint_center / left_knee | 3 | 可做短段时序候选 |
| joint_center / right_knee | 7 | 可做时序候选 |
| joint_center / left_ankle | 1 | 锚点不足，不能直接插值 |
| shoe_proxy / left_ankle | 3 | 可做脚底候选，但最大步长约35.97px，需复核 |
| shoe_proxy / right_ankle | 4 | 可做脚底候选，最大步长约9.74px |

最大相邻步长是二维候选轨迹的诊断指标，不是动作速度真值。左踝同时存在“joint_center单点”和“shoe_proxy三点”两种语义，不能混为一条骨骼轨迹。

## Direct implication

ViTPose选择改善了若干关节候选，但目前点位分布不均，不能直接对整段做统一插值。右膝和右脚底已有足够局部锚点；左膝只覆盖前段；左踝骨关节缺少锚点，应交给前后帧姿态/骨架推断，而左脚底代理可独立用于接触候选。

## Not yet proven

线性插值是否保持骨长、动作峰值、转身和第64帧腾空尚未验证；没有将2D轨迹重建为3D，也没有与白模投影做A/B。最大步长异常可能来自源动作、相机/时间映射或点语义混用，不能单独归因ViTPose。

## What would verify it

下一步只对有至少两个可靠锚点的部位做时序骨架拟合；左踝joint_center不补造本帧坐标，使用膝/髋、右侧和脚底代理作为软约束。将前踢、收腿、转身和64腾空作为阶段边界，比较线性、四元数/骨架插值与原恢复在留出清晰帧的投影、骨长、左右身份和脚底关系。通过后再送入Blender迁移。

证据：`docs/agents/raw/2026-10-29-addams-temporal-soft-fusion-v1.json`。
