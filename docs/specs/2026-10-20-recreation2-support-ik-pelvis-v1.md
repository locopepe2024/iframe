# 支持段复核、局部鞋底IK与独立骨盆校准

2026-10-20开始，2026-10-21完成。只改隔离诊断，不改主builder/rig/服务。

## Evidence and boundary

重新查看源视频解码1–61全部帧鞋部裁剪（独立于白模输出）。平底支持候选17–37画面右鞋、43–55画面左鞋；用源XY踝点确认它们分别对应语义left/right。1–15有倾斜鞋、39–41换脚、另一只鞋的鞋缘/反光证据不够，不冻结。视觉接触不等于真实受力或三维地面。

基线为fixed-length-temporal-v1/fixed_temporal。分开两个实验，不叠加挑分：

1. IK仅：固定48整数输出帧基线，支持段内锁定入段帧的固定48顶点鞋底patch质心；目标不是恢复地面。肩/髋/root/另一腿不改，保持踝/脚世界旋转。每帧踝目标总位移最多0.04 Blender units（约腿长5%，未公制标定），入段/退出用2输出帧渐变。对照无IK/局部IK。不改倾斜鞋姿态。不把patch速度下降当真实接触通过。
2. 骨盆仅：同fixed_temporal输入、相机轴、原root/yaw，骨盆关闭/身体静止轴校准后开启；子骨全部重算。身体横轴用left_hip→right_hip，躯干作为up提示，Gram-Schmidt优先精确保留横轴，构造det=+1基。目标world骨盆=targetBody×inverse(restBody)×restPelvis；基于当前骨盆world旋转转回自身局部基底。零变换与已知root yaw合成检查必须通过。记录各轴、三维/屏幕髋方向残差、骨盆目标误差，不把正确执行等同源深度真实。

## Verification and acceptance

- 基线复现、输入哈希不变、IK上身/另一腿保持、骨长、端点、修正上限与不可达量；序列独立重导入差<0.01px。
- 28独立源样本×12关节、六事件1/17/23/29/41/55、48输出帧；关节/踝median/P95/max、鞋底支持段位移速度/测试高度残差、边界步长、髋方向。
- 没有真实地面，穿地仅相对入段参考高度报告为proxy，不称真值。
- 局部IK若压低patch位移却明显推偏源踝点，不作为修复。骨盆若后段改善但前段恶化，不合入。保留异常，不扫权重、不挑帧拼接。

## Paths

- 支持复核：`docs/agents/raw/2026-10-20-support-review/`
- IK：`docs/agents/tools/recreation2_support_ik_probe.py`，远端`/tmp/iframe-rig-space-20261019/support-ik-v1/`
- 骨盆：`docs/agents/tools/recreation2_pelvis_camera_probe.py`，远端`/tmp/iframe-rig-space-20261019/pelvis-camera-v1/`
- 汇总deliverable和rolling spec summary记录最终结果。

## Result

IK支持段前段patch更稳但踝中位11.43→11.94px；后段踝16.53→9.66px但残留漂移且8输出样本触顶。骨盆两种up均正确执行目标、所有组重导入0px；躯干up组源17全身6.86→15.92px，源55为18.32→12.13px，前段上身恶化而后段下身改善。两实验分开，不叠加追分，接触/全身/H3未通过。[完整报告](../agents/deliverables/2026-10-20-recreation2-support-ik-pelvis-v1.md)。
