# Blender 3D 人体动作提取与复刻 Summary v1

## 1. 目标

建立一条可自部署、可复核的动作复刻链：

```text
源视频
→ 目标人物选择
→ 2D/相对 3D 关键点
→ body-local 坐标系
→ Blender 骨骼重定向
→ 白模静帧/短视频验证
→ 深度参考视频
→ H3/Seedance reference video
```

当前目标是先让 Blender 白模正确复制代表性姿势，再恢复连续动作和视频模型测试。

## 2. 业务范围

复刻需求分为三类：

1. 商品替换：人物动作不变，替换商品或包装。
2. 人物替换：目标人物外观改变，动作和镜头尽量保持。
3. 动作参考：从源视频提取人物动作，驱动白模或作为视频模型参考。

当前重点是第三类动作参考，尤其是：

- 跳跃和旋转
- 肩、上臂和髋部方向
- 腰椎/躯干弯曲
- 脚部接触和离地
- 多人物场景中只跟踪居中人物

## 3. 约束

- media 主机只有 CPU。
- Blender 路径：`/opt/blender-4.5.9/blender`。
- 不把友商 SaaS 作为生产依赖。
- H3/Seedance 当前以参考视频为主，不能假设其已提供显式 pose/depth control。
- 单目视频深度是相对估计，不是真实测量深度。
- 单帧验证和连续视频验证必须分开。

## 4. 已检查的自部署项目

| 项目 | 能力 | 当前判断 |
|---|---|---|
| MediaPipe Pose/Holistic | CPU 2D/相对 3D 关键点 | 当前基础层，继续使用 |
| MMPose / RTMPose | 2D 姿态及部分 3D 模型 | 作为对照和漏检恢复候选 |
| VideoPose3D | 2D 序列转相对 3D 关节 | CPU 3D 实验候选 |
| ROMP | 单目 3D 人体/SMPL | GPU 优先，暂不进入 media 主链 |
| 4D-Humans | SMPL 类 3D 人体 | GPU 优先，暂不进入 media 主链 |
| 3dPoints2Blender | MediaPipe/动作数据到 Blender | 与当前路线最接近的导入参考 |
| sl-animation-blender | MediaPipe Holistic 到 Blender | CPU/Blender 对照实现候选 |
| Rokoko Studio Live Blender | 骨骼映射、T-pose、retarget | 参考重定向机制，不作为采集器 |
| x6ud/controlnet-render-blender-addon | Blender 生成 depth/normal/edge | 只能生成参考图，不能从视频提取姿态 |

以下不作为自部署依赖：Plask、DeepMotion、Auto-Rig Pro。

## 5. 当前实现

### 5.1 motion-track.v1

当前轨迹包含：

- semantic joints
- joint confidence
- hip/shoulder center
- pelvis axis / shoulder axis
- torso vector and length
- foot targets
- foot contact candidates
- selection status
- source frame and timestamp

当前没有真实 lumbar landmark。`spine_lower`、`spine_mid`、`spine_chest` 是几何代理，不是模型直接观测点。

### 5.2 Blender rig

media 白模真实骨骼已经读取并确认：

- `pelvis`
- `spine_lower`
- `spine_mid`
- `spine_chest`
- `clavicle_l/r`
- `upper_arm_l/r`
- `lower_arm_l/r`
- `upper_leg_l/r`
- `lower_leg_l/r`
- `foot_l/r`

rest pose 主要方向：

- spine：Z 轴
- upper arm：X 轴
- upper leg：-Z 轴
- foot：-Y 轴

### 5.3 单帧验证工具

已实现：

- `tools/motion_track/build_single_frame_validation.py`
- `tools/motion_track/render_single_frame_validation.py`

代表帧：

```text
1, 60, 120, 150, 180, 240, 360, 480, 556
```

每帧输出：

- 原始视频帧
- Blender 白模静帧
- source frame 对应关系
- 骨骼方向诊断
- evidence boundary

单帧验证必须使用原始 `motion-track.v1`，不能使用平滑轨迹。

### 5.4 当前已知验证陷阱

曾经出现过一个闭环测量问题：求解器直接写入 evaluated bone matrix，再读取同一矩阵测量，因此方向误差为 0°。这个结果只能证明内部矩阵闭环，不能证明视觉复刻正确。

当前真正需要补充的是：

```text
Blender evaluated bone endpoints
→ camera projection
→ 与源帧 2D 关节点比较
```

## 6. 当前观察与结论

### Observed

- 使用 7 帧平滑轨迹时，快速动作姿势被平均，源帧 120 的双臂展开被破坏。
- 改用 raw 轨迹后，多个代表帧的白模姿势明显接近源视频。
- MediaPipe z 值在快速转身、背面和遮挡情况下可能产生较大相对深度变化。
- Blender rig 的 rest bone 轴和父子关系正常。
- 单纯调整时序平滑不能解决骨骼轴、朝向和深度错误。

### Direct implication

- 单帧坐标映射应先于连续时序平滑。
- 深度只能作为前后关系辅助，不能直接覆盖 2D 姿态。
- retarget 应基于 body-local frame 和目标 rig rest pose，而不是 world-space 向量叠加独立 root yaw。
- Blender 投影误差比“内部骨骼方向误差”更适合作为单帧验收指标。

### Not yet proven

- MediaPipe 相对 z 是否足以支撑快速旋转。
- VideoPose3D 在当前视频和 CPU media 上是否能改善躯干/腿部方向。
- 深度估计是否能改善 H3/Seedance 的动作一致性。
- H3/Seedance 是否真正使用参考视频中的骨骼动作，而不是只提取大致运动语义。

### Hypotheses

- 当前最大误差来自单目深度和 source-to-rig 坐标基准，而不是 Blender 骨骼缺失。
- raw 关键点适合单帧验证，平滑关键点适合连续视频。
- 2D 姿态 + 轻量 3D 序列模型可能比直接使用 MediaPipe z 更稳定。

## 7. 测试计划

### 阶段 A：单帧坐标验证

输入：raw motion-track.v1。

验证：

- 肩轴和髋轴
- spine 方向
- clavicle / upper arm
- upper leg / lower leg
- foot direction
- Blender 相机投影关节点误差

通过条件：

- 关键帧投影误差达到预设阈值
- 左右肢体没有交换
- 不出现明显反向关节
- 白模朝向和源帧一致

### 阶段 B：深度对照

同一组代表帧分别测试：

1. flatten depth
2. MediaPipe estimated depth
3. CPU 单目深度模型

比较：

- 手臂前后关系
- 躯干前倾和转身
- 髋部开合
- 脚部接触

### 阶段 C：RTMPose 对照

- 在 media CPU 上安装最小 RTMPose 推理链。
- 对相同视频抽取关键点。
- 与 MediaPipe 比较漏检、抖动和肩髋轴稳定性。

### 阶段 D：VideoPose3D

- 使用 MediaPipe/RTMPose 2D 序列作为输入。
- 输出相对 3D 关节。
- 只做 CPU 可行性和代表帧质量验证。
- 不把相对深度当成真实世界坐标。

### 阶段 E：Blender 连续动作

- 通过 body-local frame 生成 local quaternion。
- 接入 spine 分摊、脚部 IK candidate 和 contact gate。
- 先做 2～3 秒片段，再做完整视频。

### 阶段 F：H3/Seedance

- 生成白模 reference video。
- 保持 16:9、720p。
- 对比 raw 参考、平滑参考、depth 辅助参考。
- 记录动作一致性，不把模型返回成功等同于动作复刻成功。

## 8. 成功标准

### 工程成功

- 全链路可在自有主机运行。
- 中间产物可保存：motion-track、body frame、retarget bundle、白模视频、depth reference。
- 每个阶段有独立 JSON 报告。
- 失败可从未完成阶段重试，不重复已完成分段。

### 姿态成功

- 单帧左右肢体方向正确。
- 肩、髋、躯干方向与源帧一致。
- 跳跃和落地姿势可辨认。
- 白模不持续背向错误方向。
- 脚部不出现明显穿地或反向弯折。

### 模型参考成功

- H3/Seedance 输出保持主要动作节奏、方向和姿态段落。
- 结果需要通过人工对照和关键帧检查，不仅依赖 API 状态。

## 9. 当前分支与提交

复刻分支：`fix/recreation-optimization-v1`

相关提交：

- `441bb136`：单帧姿态验证初版
- `6965d757`：raw 单帧验证和深度对照
- `590355e4`：自部署动作捕捉候选矩阵

当前不部署生产，不直接修改主线。后续完成独立验证后，再提交管理员合并。
