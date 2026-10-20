# 骨盆到肩端点传递与脊柱参考方向隔离

2026-10-21。实验已完成；隔离运行，不改主链路/rig/服务。

## Code facts and hypothesis

`spine_target`将当前bone世界方向与源torso方向按0.35/0.65/1混合。调用者传入的`rest_direction`是已受骨盆和先前父骨旋转影响的当前方向，不是静止参考。骨盆开启会改变该输入。因此“所有子骨重算”并不代表脊柱使用相同world目标。

假设：部分肩端点偏移来自这个目标依赖；尚未量化其影响，也不能据代码断定它是最大因素。锁骨head间隙/侧向偏置与twist可能单独影响端点。

## Experiment

同fixed_temporal输入、原root/yaw、镜头、Y、rig、骨长、PTS、IK关闭。四组预设：骨盆关闭（原基线）；开启髋轴+躯干up（精确复现前轮）；开启骨盆但三个脊柱world目标逐帧冻结为关闭组目标；关闭骨盆且冻结同目标（零效应控制）。不冻结局部四元数；每组仍按自身父空间求解。唯一候选干预是脊柱目标参考来源，不改变权重或扫参数。

记录每帧reset/骨盆后/逐级spine后/锁骨后肩端点；最终记录pelvis→spine_lower→spine_mid→spine_chest→clavicle→upper_arm的world/屏幕端点、实际父链和段向量。以真实父链将肩位置拆成骨盆头位置+各级head到head向量，差值向量相加须重建总位移。屏幕用逐点投影差相加（不把world长度直接当屏幕位移）。比较spine目标、实际方向、twist和off/on肩端点。

## Verification

原始关闭/开启组逐值复现上一轮bundle；冻结关闭组逐值等于关闭组；root/yaw/key/输入哈希不变，renderer重导入<0.01px。28独立源样本、48输出帧、六预选事件1/17/23/29/41/55报告全身/上身/踝投影及鞋底速度；前段改善不能覆盖后段恶化。没有源3D/地面真值，不能由本实验验收H3或归因全部误差。

## Paths

`docs/agents/tools/recreation2_shoulder_chain_probe.py`；远端`/tmp/iframe-rig-space-20261019/shoulder-chain-v1/`；证据`docs/agents/raw/2026-10-21-shoulder-chain/`；完成后写deliverable和rolling summary。

## Result

四组控制/重导入通过。脊柱world目标冻结使骨盆开启组全关节中位数12.12→10.34px、源17为15.92→12.52px，仍差于关闭组8.58/6.86px；源55为12.13→11.34px。第17帧冻结后骨盆→下脊柱head仍向左10.09px，胸→左右锁骨head仍向左6.69/3.35px；相同脊柱方向但完整world旋转差约38°。方向参考依赖仅解释部分恶化，端点偏置与轴向自由度尚未约束。[报告](../agents/deliverables/2026-10-21-recreation2-shoulder-chain-v1.md)。
