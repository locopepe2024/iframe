# 复刻动作恢复 Spec Summary v1

日期：2026-10-14。范围：单人视频到人体动作、目标骨架和复刻参考资产的候选链路。本文记录验证边界，不将研究试验视为已上线能力。

## Observed

- GVHMR 官方代码中的 `-s` / `--static_cam` 跳过视觉里程计。动态相机模式（不加 `-s`）默认使用 SimpleVO；只有显式设置 `--use_dpvo` 才调用 DPVO。官方 README 的旧句子称动态相机由 DPVO 估计，但同一 README 的更新说明及 `tools/demo/demo.py` 的分支表明当前默认已改为 SimpleVO。依赖名称是 **DPVO**，不是 PDVO。代码来源：GVHMR 上游版本 `ee960bb6e2ea2d381aa97f08e9b71ef320b624b1`，`tools/demo/demo.py`、`hmr4d/utils/preproc/slam.py`。
- [本地 GVHMR CPU 研究记录](../../../gvhmr-cpu-validation/CPU-VALIDATION.md)中的 90 帧预处理和 SMPL-X 参数解码能够执行。该测试源片相机可见移动，SimpleVO 在默认参数下未得到有效相机轨迹；改用“假定静态相机”的结果标记 `world_trajectory_validated=false`。这些运行事实不构成动作精度证明。
- [iFrame 骨架方向验证](2026-09-30-director3d-motion-pipeline-bundle-v1.md)发现另一层独立误差：早期 Blender 白模映射在测量肢体上达到 52–167 度方向误差。即使上游 SMPL-X 姿态有效，下游骨架转换仍需单独验收。
- [HighTorque-Robotics 的整合仓库](https://github.com/HighTorque-Robotics/Mini_Pi_Plus_GVHMR-and-GMR) README 描述 GVHMR 视频姿态提取接 GMR 机器人动作重定向/BVH，并以派+动作训练为用途。该 README 没有给出 Mixamo 角色、GLB、Blender 插件或源帧动作精度的验收证据。

## Direct implication

复刻链路须把 `视频取证 → 相机轨迹 → GVHMR 原生人体重建 → 目标骨架重定向 → Blender/GLB 输出 → 源帧验收` 分层记录。GLB 能导入 Blender/Unity 只证明资产可用，不证明源动作、世界轨迹、脚接触或双手持枪关系准确。照片输入只提供单帧姿态线索，不能作为连续动作恢复的时间证据。

动态相机样本不得用 `-s` 的输出宣称世界空间轨迹合格。SimpleVO 失败时，应先检查相机估计条件，再在具备 DPVO/CUDA 环境时做同片对照；安装 DPVO 本身不等于轨迹正确。现有 CPU 验证未运行 DPVO。

## Not yet proven / Hypotheses

- DPVO 能否在当前移动镜头素材上稳定恢复相机旋转和轨迹，以及它是否改善 GVHMR 源帧对齐，尚无实测。
- 我们观察的白模误差有多少来自相机估计、GVHMR 本体、坐标变换或目标骨架重定向，尚未用同片分层实验归因。
- 外部 Mixamo/GLB/Blender 插件方案是否包含自动骨架校准、接触约束或可用于 iFrame 的授权，尚未核实。HighTorque 的机器人 GMR 流程不等同于 Mixamo 角色流程。

## What would verify it

1. 固定同一段带源帧/PTS、镜头移动标记及可见动作事件的短片；记录输入、模型权重、相机方案和输出哈希。另选确认为固定相机的短片作基线。
2. 分别跑 SimpleVO 与具备运行条件时的 DPVO；检查有效轨迹、相机方向连续性、明显失跟区间及源帧回投。失败轨迹不能继续作为世界动作真值。
3. 在尚未重定向的 SMPL-X 上比较源帧姿态事件、人体朝向、关节回投和根轨迹；遮挡部位标为不可评。仅当该层合格，再将同一动作送入目标骨架。
4. 在目标角色及 Blender 重导入的 GLB 中，按相同帧/事件复核骨骼方向、脚地面关系、手与道具的可见接触、动作连续性；记录每层首次失配的位置。

和 [枪法_2 复刻验证计划](../agents/deliverables/2026-10-13-recreation-failure-dimensions-validation-plan-v1.md)的关系：本摘要是可选的 3D 动作恢复分支，不替代该计划中的源帧证据表、镜头切点与 H3 输出验收。
