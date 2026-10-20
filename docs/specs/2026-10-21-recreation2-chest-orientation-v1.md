# 胸廓完整朝向单变量对照

2026-10-21。实验完成。隔离目录运行，不改主builder/rig/服务。

固定fixed_temporal输入、相机/root/yaw/PTS/骨长，IK关闭。五组预设：骨盆关闭；骨盆开启且冻结三节脊柱world方向（复现前轮）；在该组上只将胸骨完整world旋转改为关闭组同帧旋转；在该组上只用源肩横轴+torso构造完整胸廓旋转；关闭骨盆且胸骨改为自身关闭组旋转的零效应控制。

源胸廓构造优先保留torso作为up，再将left_shoulder→right_shoulder投影到up正交平面，forward=up×right，det=+1。rig静止肩横轴/torso构造restChest，目标=sourceChest×inverse(restChest)×restChestBone。变换在胸骨方向求解之后、锁骨求解之前应用，并按当前world基底右乘局部增量；随后重算锁骨/手臂/腿。不修改胸骨head或骨盆方向。

先验证静止轴/非零parent旋转下已知target恢复；原两组逐值复现、关闭控制投影<0.01px、所有组root/key不变、renderer重导入<0.01px。28独立源样本、48输出帧，六事件1/17/23/29/41/55报告全身/上身/踝、肩头/锁骨头位移、胸骨head保持、完整旋转/方向残差、鞋底速度。源肩横轴不是3D真值，来源深度未校准；不按输出分数挑旋转或扫权重。若改善局部但前段或后段退化，不合入主链路。

工具`docs/agents/tools/recreation2_chest_orientation_probe.py`；远端`/tmp/iframe-rig-space-20261019/chest-orientation-v1/`；证据`docs/agents/raw/2026-10-21-chest-orientation/`。完成后写deliverable和rolling summary。

结果：五组控制通过，重导入均0px、零效应<0.000075px，胸骨head保持。第17帧取关闭组完整旋转使左右肩回移6.65/3.11px、全身12.52→10.26px，仍差于骨盆关闭6.86px；源肩轴组55为11.34→10.45px，前段仍退化。源肩轴身体frame映射保留rig胸骨轴与torso约11.02°静止夹角，不是纯twist干预。未合入主链路，接触/H3未通过。[报告](../agents/deliverables/2026-10-21-recreation2-chest-orientation-v1.md)。
