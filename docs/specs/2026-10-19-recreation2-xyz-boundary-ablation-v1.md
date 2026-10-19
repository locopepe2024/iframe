# recreation2 XYZ 使用边界拆分 v1

2026-10-19。授权范围：在诊断链路隔离XYZ语义与下游用途，不改主builder、rig或服务，不发布H3参考。

## 边界与假设

1. 图像轴尺度：对方向输入的Y乘792/1394；原始XY/Z不覆盖，投影评分仍用原始XY。它只是图像尺度补偿候选，不等于三维反投影。
2. 髋相对Z与root位移：当前root使用髋均值Z。其几何意义不足，但本轮固定原root位置/yaw，避免与第一项混合。后续需要独立root约束，不从髋相对Z推绝对轨迹。
3. rig旋转空间：沿用已验证可复现的no_pelvis_root诊断基线；本轮固定原混合旋转基底，骨盆关闭。骨盆/自身基底校准另列，不同时修改。

## 首个实验

预先固定两组：`raw` 与 `image_y_width_units`。同轨迹、同PTS anchors、同rig、同镜头、同原root、同骨长、同旋转算法；后者仅对目标方向中的Y乘0.5681492109038737。无滤波、无IK、无新接触目标、无逐帧挑选。

检查全部28个独立源样本、29个PTS key和48个输出帧。重点列源1/17/23/29/41/55；异常输出27→28和32→33单列。脚部使用既有固定蒙皮patch，仅报告世界轨迹与位移，不把patch高度当真实地面或沿用未验证支持标签。

## 成功标准

- 工程验证：raw bundle与旧no_pelvis_root的root/四元数逐值一致；两组root/key完全一致；输入XYZ哈希不变；独立renderer重导入与求解姿态投影差<0.01px。
- 研究结果：报告全部源样本的投影中位数/P95/最大值、选定六帧均值、踝点指标、输出最大关节步长及两侧patch水平速度；改善和恶化均保留。
- 补偿组前四帧任一恶化时，不称其已通过前段改进；即使全部改善，仍不代表真实深度、地面或H3验收通过。

## 路径与命令

- 诊断脚本：`docs/agents/tools/recreation2_xyz_scale_probe.py`。
- media隔离目录：`/tmp/iframe-rig-space-20261019/xyz-scale-v1/`。
- 输入沿用其父目录的`track-2s.json`、`pts-retime-anchors.json`、`contact-out2/no_pelvis_root.bundle.json`和`two-bone-v1/report.json`固定patch。
- 运行：`/opt/blender-4.5.9/blender -b --python recreation2_xyz_scale_probe.py -- --track track-2s.json --rig /home/ubuntu/director-deploy-r2/assets/characters/white-model-neutral-female-v1/blender/white-model-neutral-female-v1.blend --anchors pts-retime-anchors.json --baseline contact-out2/no_pelvis_root.bundle.json --patches two-bone-v1/report.json --out xyz-scale-v1`。
- 原始报告：`docs/agents/raw/2026-10-19-xyz-scale/`；结论：对应deliverable并更新rolling spec summary。运行日志和新报告必须检查，Blender退出0不独立证明脚本完成。
