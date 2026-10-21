# Pinned Blender rig 空间闭环验证

2026-10-21。沿用已固定的white-model-neutral-female-v1 .blend、现有 no_pelvis_root 隔离bundle及源PTS锚点。仅新增docs/agents下的诊断脚本、摘要与小型数值报告；不改主builder/renderer/rig/服务，不输出新动作参考。

## 目标与边界

在真实Blender rig内，给定某一姿态已知的全部骨骼世界矩阵，重置姿态后按父先子后的顺序调用 Bone.convert_local_to_pose(invert=True) 恢复 matrix_basis。检查完整世界矩阵、头尾端点、非轴向代理点以及现有renderer支持的四元数/root序列化往返。静止轴、Inherit Scale、约束/驱动存在性要记录；若非纯旋转basis则报告serializer边界，而非静默只取四元数。

预选帧为源1/17/23/29/55。以现有bundle的姿态为前向真值，并注入非零root yaw、骨盆旋转与胸廓twist作为覆盖用的合成扰动。这些源帧号只是取样位置，不代表真实视频姿态真值。负对照单独漏rest、漏root与只比骨方向；改变后恢复正确姿态，避免污染其他对照。

验收：记录输入/rig哈希和Blender版本；每帧全部骨骼世界旋转与关节头尾/侧向代理点差、屏幕投影差；完整姿态导出和renderer重导入差。若任一关键闭环超阈值，定位具体骨名/变换边界。不要据此宣布源重投影、鞋底、接触/H3通过。

运行于media host的Blender 4.5.9，只写/tmp诊断目录，取回小型JSON及简短日志。完成后报告结果和未验证项，原有主链路保持不变。

## 结果

5个预选帧×73骨的已知姿态逆解/FK与renderer重导入通过。世界矩阵最大元素误差分别3.58e−7/4.77e−7，最大投影误差分别1.11e−4/9.16e−5 px。漏rest/root负对照为0.185–0.202/0.0207–1.697矩阵元素差；60°局部twist保留骨方向却使侧向点偏移0.08062 Blender units。只能证明固定rig的已知姿态闭环，不能验真实源运动或鞋底接触。[报告](../agents/deliverables/2026-10-21-recreation2-pinned-rig-roundtrip-v1.md)。
