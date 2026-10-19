# recreation2 rig 空间校准实验 v1

范围：在相同源轨迹、pinned rig、源 PTS 锚点和固定渲染镜头下，隔离身体轴、骨盆局部旋转和 root yaw。此实验不修改生产 retarget 或发布配置。

已知：旧骨盆矩阵行列式为 −1；只修叉积更差；禁用骨盆并重算是对照基线。假设：以 rig 静止身体坐标为参考、在骨头自身基底求局部旋转、在求解时包含渲染 root yaw，能够减少空间映射误差。结果以实测为准。

实验路径：`docs/agents/tools/recreation2_rig_space_probe.py`；原始产物：`docs/agents/raw/2026-10-19-rig-space-calibration/`。远端仅在 `/tmp/iframe-rig-space-20261019/` 写诊断文件，读取 pinned rig，不改服务或资产。

步骤：读取 rig 静止骨盆矩阵和髋/肩语义轴；构造同约定的右手身体参考帧；目标骨盆世界旋转为 `target_body @ rest_body.inverted() @ rest_pelvis`；用骨头自身世界旋转将世界 delta 转回局部。分别保留旧子骨骼算法、更正子骨骼基底、加入 root yaw，形成隔离对照。复用既有 PTS 锚点以保持采样与停顿一致。

验收：记录每个轴、矩阵行列式、实际骨盆旋转与目标的角差、各肢段方向残差；源第 1、17、23、29、41、55 帧比较 12 语义关节投影。新方法须在前四个验证帧均优于无骨盆对照，并单独报告后段。投影降低不能证明深度或脚接触准确；未通过地面/接触和全片验收时不进入 H3。

命令：将 probe、现有 builder/renderer、track 和 anchors 复制到隔离目录；`/opt/blender-4.5.9/blender -b --python recreation2_rig_space_probe.py -- --track track-2s.json --rig <pinned-rig> --anchors pts-retime-anchors.json --out <diagnostic-dir>`。脚接触先记录足端世界高度/位移与支持期候选，不在本轮用锁脚掩盖方向残差。
