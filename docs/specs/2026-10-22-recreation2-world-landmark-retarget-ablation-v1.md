# MediaPipe world pose 到 pinned rig 的隔离重定向对照

承接同源world伴随抽取和Blender rig逆解闭环。只比较方向输入表示，不修改主builder/提取器/renderer/rig，不输出生产bundle。

## 假设

- 输入来自已验证同decoded-frame的image/world landmarks配对，PTS sidecar是主要选择；转换坐标不重抽样、不改帧身份。
- 用弱透视投影拟合在静态背景证据窗（源PTS≤1.898857秒）得到的共享3x2方向，再用右手补足第三轴，作为估计源观察坐标到图像的方向。不是标定的源相机。
- 将该方向映射到renderer目标相机的右/下/前轴，形成world landmark方向代理。仅取相对髋中心点；不把髋相对米制坐标填入root绝对深度。
- 用当前生产builder在pinned rig上重新求子骨局部四元数。输出后逐帧覆盖回同baseline的rootPosition/rootYaw，并保持骨盆关闭、镜头、rig和时间锚点不变。对照同一事件源1/17/23/29/41/55帧投影12个关节，同时检查完整肩/踝分解、变换残差与重导入。

## 成功条件与限制

报告图像frame/PTS/world hash、共享basis与目标相机变换；证明candidate与baseline root/yaw逐值一致。renderer重导入误差须<0.001px。无论改善或恶化都保留每关节误差；不以全段中值宣告通过。源相机、绝对深度、全身完整姿态、鞋底/地面、后段转身仍未验证，不能升级H3。

这个实验只验证“world pose加共享图像方向映射”是否比现有proxy方向更适合作为pinned rig姿态输入。弱透视拟合本身与MediaPipe world仍同源，不代表独立真值。若改善，应再做相机/根/接触分层；若恶化，检查模型world输出坐标约定及朝向估计，不直接调骨盆权重掩盖差异。

## 结果

world候选的代数方向映射闭环误差3.33e-16、目标rig方向残差0°、renderer重导入0px，但源1/17/23/29/41/55平均误差25.11/24.86/23.26/27.81/22.55/25.71px，均高于同root/own-basis旧对照12.53/17.26/13.31/21.98/16.90/24.27px。双踝候选平均误差44.46–56.54px，旧对照3.72–27.23px。结论是该未标定world→目标映射候选失败，不能推广为world输出无效或最大根因。[报告](../agents/deliverables/2026-10-22-recreation2-world-landmark-retarget-ablation-v1.md)。
