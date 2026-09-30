# Director 3D 局部 Quaternion 重定向 V1

## 范围

本切片把已通过 `motion-track.v1` 契约校验的语义关节方向，按一个已审阅的 `director-rig-mapping.v1` 映射转换为局部 quaternion。它是浏览器内的确定性计算，不上传素材、不调用模型、不写入姿态时间线。

## 输入

- `MotionTrackManifest`：已声明坐标系的逐帧轨迹。
- `MotionRetargetMappingManifest`：包含 rig profile、映射 revision、源关节对、rest direction 与 rest quaternion。

`sourceStartJoint` 和 `sourceEndJoint` 定义源方向；`restDirection` 是该方向在参考姿态中的单位向量；`restQuaternion` 是目标 rig 该关节的参考局部旋转，四元数顺序为 `[x, y, z, w]`。

## 算法边界

1. 每帧用 `end - start` 得到当前方向并归一化。
2. 计算 `restDirection → currentDirection` 的最小旋转 quaternion。
3. 输出 `restQuaternion × delta` 作为目标局部 quaternion。
4. `rootPosition` 原样独立输出；不把 root 位移混入 pelvis 旋转。
5. `pelvis` 映射单独输出 `pelvisQuaternion`，不替代 root 位移。
6. 缺失源关节、零长度方向、非 tracked/interpolated 状态只输出 warning，并跳过该关节；不得复制邻帧或邻人姿态。

## 明确不实现

- IK、脚部接触锁定、地面求交、动作清理、平滑和 quaternion 过滤。
- 深度恢复、相机校准、3D lift、骨骼自动命名或自动 mapping。
- 写入现有姿态轨道、生成视频或提交 provider。

## 验收

- 同向向量输出 `restQuaternion`。
- 90 度方向变化输出可归一化的 90 度 delta 组合。
- root 位移与 pelvis quaternion 同时存在且字段不混淆。
- 缺失关节和 occluded 帧不产生伪造 quaternion，并有稳定 warning。
- 反向向量选择确定性的正交轴，结果仍为单位 quaternion。

