# recreation2 root yaw 八组隔离

固定最终root位置/yaw、rig、相机、输入XYZ、PTS；骨盆和IK关闭。预先比较2×2×2因素：Y方向原值/792÷1394、混合/自身骨基底、求解包含yaw/仅渲染包含yaw。

所有姿态在施加相同最终root后评分；renderer重导入与这一最终姿态比较，差须<0.01px。raw_root_yaw须逐值复现既有no_pelvis_root，所有候选最终root/key必须一致。统计28独立源样本及48输出帧。不得逐帧选组，不以最小中位数替代关键帧和接触验收。

只写隔离probe及证据，不改主链路。运行目录 `/tmp/iframe-rig-space-20261019/root-yaw-v1`，probe为`docs/agents/tools/recreation2_root_yaw_probe.py`，参数沿用前轮track/rig/anchors/baseline/patches。
