# 坐标adapter隔离验证

2026-10-21；不修改生产builder/renderer/rig/服务，不输出生产bundle。

## Observed

- 新增[隔离adapter](../tools/recreation2_contract_adapter.py)，图像像素、MediaPipe髋相对proxy深度、米制camera-Z与rig刚性矩阵分开处理。相对Z不能送入米制反投影；缺失parent、反射、缩放矩阵、无效焦距及非正深度均拒绝。
- [闭环验证工具](../tools/recreation2_contract_adapter_verify.py)覆盖36个深度/位置/朝向组合，每组三级骨链，含非零相机内外参、非共轴rest/pose旋转和root yaw。已知目标矩阵逆解basis再FK，最大XYZ重建误差3.56e-15米、端点误差2.74e-15米、重投影误差3.60e-13px，骨长误差3.89e-16米。
- 负对照成功检出漏rest和漏root的矩阵失配。轴向twist相差60°时骨方向误差为0，但合成侧向端点偏移0.15米。这是人为几何反例，不是实际角色身体的测量。
- 只读源track-2s，31帧保留source_frame与源PTS，包含1/17/23/29/55。XY转换为像素再还原误差0，相对Z逐值相同。body_pose_3d、camera、root_trajectory和rig_calibration均为null。源画幅1394×792沿用已有ffprobe取证，未由关节坐标推断。
- 输入track SHA256：`0fed823bf39bd206ebeafec922a29394ee87a942b1bcc0395610a603d598550a`。

[验证指标](../raw/2026-10-21-contract-adapter/verification.json)；[拆分后的观测证据](../raw/2026-10-21-contract-adapter/observations-only.json)。

## Direct implication

在已知相机、已知米制三维姿态及完整rest/parent变换下，坐标边界可以形成精确闭环；识别噪声不是数学闭环成立的前提。当前真实轨迹缺少独立三维/相机/root信息，不能通过重命名XYZ字段将这些未知量变为真值。完整旋转与关节端点必须独立于骨方向验收。

## Not yet proven

这是numpy刚性、单位缩放、无constraints骨链验证，不是实际Blender rig的继承/约束认证；合成端点不代表角色语义关节或鞋底。没有测得真实视频误差下降，没有完成源相机标定、深度恢复、支持脚接触或H3验收。该adapter是诊断工具，不是已接入生产的数据契约。

## Hypotheses

显式区分通道后，能够把真实片段的首次失配定位到源3D/相机层或rig重定向层；此轮只建立验证工具，尚未完成该因果归因。

## What would verify it

下一切片先在pinned Blender rig上用其自身已知姿态做世界目标→local basis→重导入闭环，包含root yaw、非零父旋转、胸廓twist与真实关节头偏置。随后需要同帧可复现world输出或人体拟合候选及相机候选，先测源人体回投，再接rig。不能用现有髋相对proxy强制填入camera-Z绕过未知量。

验证命令见[规格](../../specs/2026-10-21-recreation2-contract-adapter-v1.md)；本轮运行通过，另通过两工具py_compile与git diff --check。
