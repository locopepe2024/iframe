# Pinned Blender rig 世界/局部空间闭环

2026-10-21。Blender 4.5.9 LTS；pinned rig SHA256 95eeb19c8abce2325479804b3dda429ebddfa6e8d07a2688541cc990fb676855。同一既有诊断bundle的源1/17/23/29/55帧取样，在实际rig上前向生成世界目标、逆解局部basis、按父先子后FK，并经现有renderer四元数/root重导入。额外的13° root yaw、11°骨盆旋转、35°胸廓twist是测试扰动，**不是从源视频估计的值**。主链路未改。

## Observed

- rig含73骨、0个pose-bone constraints、0个armature对象/数据drivers；采样骨骼均为FULL inherit scale、开启inherit rotation/local location。报告记录各骨名称与属性。[完整数值报告](../raw/2026-10-21-pinned-rig-roundtrip/report.json)。
- Blender Bone.convert_local_to_pose(invert=True)用目标armature-space矩阵、各骨静止矩阵、实际父pose/rest矩阵恢复basis。五帧73骨的世界矩阵最大元素误差为3.58e−7；关节头尾/侧点也为浮点量级。五帧的侧点最大投影误差为1.11e−4 px。
- 将求得的局部四元数和root变换经现有renderer重新导入后，世界矩阵最大元素误差4.77e−7、侧点最大投影差9.16e−5 px。逆解basis的最大残余平移6.83e−7 Blender units、scale偏差4.77e−7，当前五帧可由四元数通道在误差阈值内表达。
- 忽略rest的负对照，胸廓世界矩阵元素差0.185–0.202；忽略root yaw则差0.0207–1.697（取决于帧）。二者显著高于闭环数值误差。
- 注入60°胸廓局部骨轴twist后，骨方向误差仍为0°，但预设侧向代理点偏移约0.08062 Blender units。这是已知几何偏置点的合成测试，不是源肩位置、胸围或鞋底实测。
- 预选源帧均与源PTS锚点保持配对。既有隔离程序重跑时，no_pelvis/no_pelvis_root等投影数值与先前报告一致；本轮新闭环只比较已知rig姿态，不把这些旧组误差当成新改善。

## Direct implication

在此pinned rig的已测姿态中，Blender自身的rest/parent/root空间转换可以精确恢复，renderer序列化没有引入可见量级的姿态误差。先前前段上身恶化不能简单归咎于“四元数导出必然丢失父空间”；更应逐层比较输入世界目标与语义端点如何定义。不过，使用错误的rest/root变换会造成远大于数值误差的偏移，且骨方向对齐不保证侧向端点对齐。

## Not yet proven

- 前向目标来自既有builder产物在rig上的已知姿态，不能代表真实源视频3D或正确胸廓/骨盆朝向；闭环成功是接口一致性，不是动作保真。
- 未检查源相机内外参、真实单目深度、角色网格鞋底接触、ground plane、遮挡与后段构图变化。脚接触/H3仍不通过。
- 结果只覆盖固定rig及五个合成扰动姿态，不自动保证别的rig继承设置、约束、动画驱动或所有帧都适用。网格与其他对象的驱动未单独审计。

## Hypotheses

此rig上的主要未定位误差更可能出现于“源图像观测/3D与相机→目标世界姿态和端点”的构建，而非已测的“正确世界姿态→局部basis→renderer”通道。真实误差归因尚需同源3D/相机候选分层测试。

## What would verify it

沿用源1/17/23/29/55及后段支持脚阶段，首先对可复现的源人体/相机候选计算2D重投影及不可见标记；再以同一世界骨盆/胸廓/肩端点目标进入pinned rig，逐层记录完整旋转、关节头和侧向代理点误差。只有源人体层过关后才单独验证鞋底patch、地面与局部IK。不要从当前髋相对proxy填造绝对root深度。

工具：[recreation2_pinned_rig_roundtrip.py](../tools/recreation2_pinned_rig_roundtrip.py)。脚本完成标记 PINNED_RIG_ROUNDTRIP_PASS；Blender日志无traceback，py_compile与git diff --check通过。预先规格：[pinned-rig-roundtrip-v1](../../specs/2026-10-21-recreation2-pinned-rig-roundtrip-v1.md)。
