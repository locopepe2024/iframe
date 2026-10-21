# 隔离坐标adapter与零噪声闭环

2026-10-21；承接mapping-contract-research。仅在docs/agents/tools添加诊断模块与验证工具；不改主builder、renderer、rig、提取器或服务，不输出生产bundle。

## 假设与边界

显式区分图像观测、米制三维人体、已知相机、世界root与rig标定。MediaPipe相对Z只保留作来源证据；没有已声明的米制camera-Z不得反投影。源相机未知时不填目标镜头作真值。已知3D合成输入用于验证数学闭环，不能验证真实MediaPipe深度。

简化rig假设：刚性、单位scale、无constraints；局部矩阵=rest×basis，世界矩阵=parent×rest×basis。非默认继承/缩放与真实Blender受约束rig不在该numpy闭环内，后续须独立调用Blender API验证。

## 验收

- 透视投影/米制深度反投影闭环，非零内外参、人物横向位置、深度、朝向与root yaw。
- 通过完整旋转与固定rest关节偏置构造三级骨链；从世界目标恢复basis，再做FK。验旋转、端点、骨长与像素误差。
- 负对照：相对Z不能当米制Z；缺相机/根轨迹不补零；反射矩阵、无效深度、非正交旋转拒绝。漏rest、漏root与仅方向相同但twist不同的对照应能被完整旋转/端点检查检出。
- 只读现有track，输出来源哈希、帧号/PTS、图像观测和相对Z；未知3D/相机/root/rig标定显式null。对源1/17/23/29/55保留观测，不伪造重建。

命令：`python3 docs/agents/tools/recreation2_contract_adapter_verify.py --track /private/tmp/cozyclay-media-real-20261019/track-2s.json --out docs/agents/raw/2026-10-21-contract-adapter`。结果写deliverable并更新rolling summary；只提交本轮路径，不push。

## 结果

36组×3骨闭环通过，最大重投影误差3.60e-13px、端点2.74e-15米；六种非法契约拒绝通过。方向不变而twist改变的负对照产生0.15米侧向端点差。31帧真实观测转换回原XY误差0，未知3D/相机/root/rig显式null。numpy刚性层通过，不证明实际rig或真实片段精度/接触通过。

[报告](../agents/deliverables/2026-10-21-recreation2-contract-adapter-v1.md)。
