# 相机轴完整姿态隔离

预先固定四组：raw_world（原尺度/世界轴）、scaled_world（792÷1394/世界轴）、scaled_camera（相同尺度/相机轴）、pixel_camera（360÷640/相机轴）。各组自身骨基底、同root/yaw、骨盆与IK关闭，统一处理torso/clavicle/limbs。世界目标不再乘root yaw；root yaw在求解骨架中体现。

raw_world必须逐值复现上轮raw_own_root_yaw，所有组root/key一致。独立renderer重导入差<0.01px；28独立源样本、48输出帧、全部12关节分位数、六事件帧、两踝、步长和固定patch速度均报告。不挑选帧拼接，不调整镜头或IK。

仅诊断目录 `/tmp/iframe-rig-space-20261019/camera-retarget-v1`，不改主链路/rig/源XYZ。接触只能量rig代理轨迹，没有真实地面不称接触通过。均值或中位数改善不能覆盖关键帧与连续性。
