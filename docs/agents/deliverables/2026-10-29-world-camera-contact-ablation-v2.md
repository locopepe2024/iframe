# 世界动作、镜头与接触：拆分对照 v2

## Observed

**代码事实**：`addams_native_layer_score.py`使用`smpl_params_incam`和`motion.incam.joints`生成迁移输入；`addams_native_retarget_probe.py`固定相机并按相机坐标设置根位置。其注释明确用于同镜头诊断，不能直接作为世界接触生产路径。模型文件同时提供global和incam两组数据。

**运行观测**：原候选camera up为−Z，head−pelvis也指向−Z。此前直接按+Z-up/min-Z选择脚底不能作为接触验收。已把第一轮报告标记为历史诊断。

将原候选所有顶层对象（含相机）共同旋转到camera-up=+Z，检查三帧投影差为0。分别独立重载文件，测试无约束、仅启用求解器、仅高度、仅XY、完整约束。求解器空载踝变化约0.002mm，非支持踝与骨盆未发生可测位移。

| 坐标候选/约束 | 49帧踝校正cm | 52帧踝校正cm | 53帧踝校正cm |
|---|---:|---:|---:|
| camera-up候选，仅高度 | 2.434 | 0.0002 | 0.438 |
| camera-up候选，仅XY | 0.0002 | 19.749 | 24.385 |
| camera-up候选，完整约束 | 2.434 | 19.748 | 24.389 |
| inferred-global候选，仅高度 | 1.350 | 1.430 | 0.0002 |
| inferred-global候选，仅XY | 0.0002 | 3.386 | 5.774 |
| inferred-global候选，完整约束 | 1.350 | 3.676 | 5.774 |

**内部一致性验证**：35帧global与incam各22关节间可拟合det=+1的刚体变换，最大三维残差5.05e-7模型单位。该变换写为可编辑Blender父级与随动相机，35帧头、骨盆、双踝回放最大投影差0.000178px。

新诊断文件：`media:/tmp/addams-pose/gvhmr-native-v1/inferred-world-camera-candidate.blend`。原姿态、比例、投影误差保持；新增的是世界动作与推断相机的分离。

**可见关节验证**：同一批19个人工确认点，完整接触IK前后RMSE如下，尺寸960×520。

| 源帧 | 点数 | 原候选px | 完整IK后px |
|---|---:|---:|---:|
| 49 | 7 | 69.84 | 69.76 |
| 52 | 6 | 42.76 | 44.38 |
| 53 | 6 | 51.57 | 52.13 |

这不是全片或全部标注点的分数。IK修复接触并不自动改善源动作投影；52/53帧反而小幅变差。

## Direct implication

相机坐标候选的水平锁定是本轮大幅IK校正的直接触发条件；地面高度不是该候选中全部问题的解释。相机坐标诊断必须先转入明确的世界/地面契约，才能检验世界脚滑。

已有global/incam输出足够构建内部一致的镜头/人物分离候选，无需为了这个验证重新推理模型或新增人工标注。完整IK的49/52帧满足暂定5cm位移门槛，53帧5.77cm不满足；不能晋升整组。

## Not yet proven

- global也是模型估计；刚体拟合与投影一致不能证明真实相机、真实焦距、重力或真实深度已恢复。
- 两种候选分别按各自向上方向选最低接触顶点（7372和7204），因此上述校正量差异不能全部归因于根轨迹。接触点定义与地面方向也参与变化。
- 支持窗只有三个人工确认帧；未证明同一鞋底点应一直固定，未验收垫脚、转轴或连续脚滑。
- 原源姿态/目标骨架的二维误差仍显著；世界重表达本身不会降低这些误差。
- T1已通过的只是左右归属、代理往返检查，尚非完整权重/骨架/视觉资产验收。

## Hypotheses

53帧残差可能包含接触点切换、根轨迹估计误差和目标骨长/旋转迁移误差。当前证据不能给出主因排序；不增加深度自由度来掩盖该差异。

## What would verify it

1. 以同一固定网格接触点复测两种候选，隔离空间变换与代理点选择的贡献。
2. 仅在已确认支持窗中分析heel/forefoot接触转移，允许物理合理的脚掌滚动，不强锁整鞋。
3. 在世界候选上同时约束少量可见关节与目标接触，控制修改幅度，并单独报告未拟合帧结果。
4. 前段通过后再扩到源37–65及全片；保持人物、动作、场景、镜头资产分层。

## Artifacts and reproduction

`docs/agents/raw/2026-10-29-addams-native-layered-v1/`：

- `target-contact-ablation.json`：原始−Z-up候选诊断，不作为接触验收。
- `target-contact-ablation-canonical-up.json`：统一camera-up后对照。
- `camera-world-contract.json`：35帧推断world/camera变换。
- `world-camera-candidate.json`：Blender投影回放检查。
- `target-contact-ablation-global-world.json`：世界候选接触及人工关节复核。

本地运行`python3 docs/agents/tools/addams_camera_world_contract.py`生成契约；复制契约和脚本到media，再运行`addams_world_camera_candidate.py`，最后运行`addams_target_contact_ablation.py -- --global-world`。仅生成诊断文件，不改生产主链路。
