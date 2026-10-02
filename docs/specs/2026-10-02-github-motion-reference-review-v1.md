# GitHub 动作复刻参考项目调研 v1

日期：2026-10-02

## 结论摘要

当前白模失败的核心不是缺少更多平滑参数，而是把以下两种坐标混在一起：

```text
世界坐标四肢方向 + 动态 root yaw
```

参考项目普遍将流程拆成：

```text
2D/3D 关键点时序
→ 时序平滑与质量指标
→ 身体局部坐标/人体参数
→ rig retarget
→ Blender 输出
```

这支持我们把 `body_frame` 和 `limb_local` 作为下一版契约，而不是继续向 `motion-track.v1` 增加零散方向字段。

## 参考项目

### 1. arinaskh/Motion-capture-project

<https://github.com/arinaskh/Motion-capture-project>

GitHub 描述声明其目标链路为：2D pose → 3D body recovery → Blender retargeting，并提到 RTMPose、4D-Human/WHAM、自定义 smoothing 和 Blender retargeting。

**代码事实级别：** 当前 GitHub 搜索结果和仓库描述支持这些组件名称；尚未审计其完整实现或运行效果。

**对我们的直接启发：** 将 2D 提取、3D 恢复、平滑和 Blender 重定向拆成独立阶段，与当前需要的 `motion-track`、`body_frame`、`full_motion.bundle` 边界一致。

### 2. Lordofmortys/Motion-Capture-Pose-Recognition-using-Blender

<https://github.com/Lordofmortys/Motion-Capture-Pose-Recognition-using-Blender>

README 要求 MediaPipe、OpenCV 和 Blender；其流程是将 JSON 关键点写入 Blender armature，使用预制 tracker armature 跟随关键点。

**直接启发：** JSON 是 Blender 之间的明确边界，便于导演台查看和重放。

**限制：** README 没有证明其解决了真实 3D 深度、根节点转身、腰椎分段或脚部 IK。

### 3. samrodrigues1/3d_model_reconstruction

<https://github.com/samrodrigues1/3d_model_reconstruction>

README 声明：

- MediaPipe 33 个 world-space landmarks；
- 视频时序平滑支持 Savitzky–Golay、Gaussian、EMA 和组合模式；
- 输出原始 keypoints `.npy`；
- 可选 SMPL；
- 提供 jitter reduction 和 smoothness score。

其代码明确存在时序平滑器和质量指标计算。

**对我们的直接启发：** 平滑必须带可量化指标，不能只依赖肉眼；应同时保存 raw track、smoothed track 和 jitter report。

**限制：** README 的“3D”仍主要基于 MediaPipe world landmarks；这不能自动证明单目深度和腰椎旋转是真实观测。

### 4. shubham-goel/4D-Humans

<https://github.com/shubham-goel/4D-Humans>

仓库描述是“Reconstructing and Tracking Humans with Transformers”。

**对我们的直接启发：** 4D 人体恢复/跟踪适合承担单目视频到时序人体参数的上游阶段。

**当前限制：** media 是 CPU 主机，不能假设 4D-Humans 在 media 上可实时或可稳定运行，需要独立性能验证或 GPU 节点。

### 5. open-mmlab/mmpose

<https://github.com/open-mmlab/mmpose>

MMPose 是通用姿态估计和基准工具箱，适合比较 RTMPose、3D pose lifting、多人跟踪等组件。

**对我们的直接启发：** 将“检测器”和“重定向器”解耦，允许 media 先用轻量 CPU 模型，未来替换上游模型而不改 Blender 契约。

### 6. Arthur151/ROMP

<https://github.com/Arthur151/ROMP>

仓库描述明确包含单目 3D 多人姿态、3D 位置和轨迹估计。

**对我们的直接启发：** 多角色和 root/global trajectory 应是独立数据层，不能只用当前 `person-center` 的中心连续性策略。

**限制：** 不能从仓库描述推断 CPU 性能或旋子动作精度。

### 7. Lordofmortys 的 MediaPipe Blender 示例

仓库中包含 `MediapipeMotionCapture.ipynb` 和 Blender 文件，属于最接近当前 CPU 快速验证的参考。

**直接启发：** 先让 JSON 轨迹在 Blender 中可重放，再加入 3D 模型，而不是把两层问题同时调试。

## 对当前失败结果的解释

### Observed

- 上臂和上腿的单帧方向误差已经可以接近 0°；
- 固定 `180°` facing offset 不能表示跳跃旋转；
- 旧 renderer 未读取 `rootYaw`，曾造成无效测试；
- renderer 同时使用世界坐标四肢方向和 root yaw 时，整体动作混乱；
- 髋轴在快速动作中会发生符号翻转和深度估计不稳定。

### Direct implication

当前必须先建立统一身体坐标系：

```text
body_frame = pelvis/shoulder/torso 的统一朝向
limb_local = inverse(body_frame) × limb_world
root_yaw = body_frame 的全局变化
```

Blender 只接受：

```text
root 全局运动
+ pelvis/spine 局部旋转
+ limb 局部旋转
```

### Not yet proven

- 髋轴单独是否足以恢复旋子转身；
- MediaPipe world landmark 的深度是否足以支持快速旋转；
- CPU 几何 proxy 是否能恢复真实腰椎和 root yaw；
- 任何 GitHub 项目是否能直接解决当前视频。

## 对 iframe 的实施建议

### Phase 1：CPU 可验证契约

新增：

```text
body-frame.v1
limb-local.v1
root-motion.v1
```

每帧记录：

- pelvis center；
- shoulder center；
- pelvis axis；
- shoulder axis；
- torso up/right/forward；
- root yaw；
- yaw unwrap 状态；
- confidence；
- axis flip / outlier evidence。

### Phase 2：局部重定向

禁止直接使用：

```text
世界 limb vector + root yaw
```

改为：

```text
世界 limb vector
→ body-local limb vector
→ Blender bone-local quaternion
```

### Phase 3：快速动作质量门

对旋子腿区间增加：

- root yaw 连续性；
- shoulder/hip axis flip 检测；
- 每帧最大角速度；
- 上肢相对胸腔误差；
- 下肢相对骨盆误差；
- 脚端接触和空中阶段标记。

### Phase 4：3D 上游替换

当 CPU 代理验证通过后，再评估：

```text
RTMPose / MMPose 2D
→ CPU 3D lifting
→ SMPL/SMPL-X/4D-Humans/ROMP
→ body-local bundle
```

不要在当前动作坐标契约未稳定前直接引入 SMPL-X 或 H3。

## 参考项目使用边界

这些项目可以作为架构和实现参考，但当前证据只支持：

- 它们存在相应的代码、README 或项目描述；
- 它们展示了 2D/3D pose、时序平滑、Blender retarget 或 SMPL 方向；
- 它们没有证明能在当前 media CPU 环境中准确复刻旋子腿转身。

下一步应优先实现 `body-frame.v1` 和 `limb-local.v1`，再重新生成白模，而不是继续叠加独立的 facing offset、pelvis offset 或 limb world rotation。
