# 单帧动作重定向校准证据 v1

## 目的

记录 2026-10-03 在 media CPU 主机上对 Blender 单帧重定向求解器的对照结果，冻结可复现基线，避免把失败的四元数变体带入连续动作测试。

## Observed

- 使用同一份 raw `single-frame-manifest-raw.json`、同一份白模 blend 和 `flatten` 深度，在 media 的 Blender 4.5.9 上复跑 9 个代表帧。
- 回退到 `rest_calibrated_body_frame_local_swing` 后，9 帧投影 RMSE 为：

  `0.0538, 0.0586, 0.0542, 0.0329, 0.0235, 0.0622, 0.0440, 0.0473, 0.0400`

- 这些帧的 RMSE 均值约为 `0.0463`。
- 代表性上臂角误差约在 `-19.7°` 到 `22.8°`；大腿角误差约在 `-13.4°` 到 `19.1°`。
- v10 的“父级姿态空间 delta”实验在相同输入下出现上臂约 `80°–100°`、大腿约 `130°–175°` 的方向反向，投影 RMSE 上升到约 `0.095–0.135`。

## Direct implication

- 当前 `bone.matrix` 基础的 local swing 是可重复的实验基线；它尚未达到动作复刻验收标准，但比 v10 公式稳定。
- 单帧求解器目前主要验证二维相对布局和骨段方向，不能证明真实三维深度、根节点朝向、轴向扭转或时间连续性。
- `flatten` 深度适合当前单帧校准；MediaPipe 估计深度应继续作为辅助对照，而不是姿态真值。

## Not yet proven

- 白模在跳跃、旋转、落地等连续片段中是否保持正确的 root yaw。
- 肩胛、腰椎分段和脚部接触是否得到真实运动。
- 当前二维投影误差是否与视频观感一致；RMSE 不能代替人工视觉验收。

## Hypotheses

- v10 失败的主要原因是把父级旋转和 rest pose 共同作用到局部目标，造成上臂和大腿的 180° 邻域翻转；这需要独立的静态坐标夹具验证，不能仅凭误差结果断言。
- 下一步应先校准“源人体 body frame → rig rest frame → camera”三个变换，再加入 root yaw 和连续帧求解。

## What would verify it

1. 建立一个人工定义的中立姿态夹具，分别测试左右、上下和前后单轴变化。
2. 输出源关节、Blender evaluated 关节和拟合后的二维投影叠加图，并逐骨段标注残差。
3. 只有当肩臂、髋腿在夹具中通过左右映射和方向测试，才进入 2–3 秒连续片段。
4. 连续片段需额外检查四元数符号连续性、root yaw、脚部接触和落地帧。

## 人工姿态夹具结果

新增 `tools/motion_track/build_pose_calibration_fixture.py`，生成 6 个不依赖检测器的姿态：中立、左右抬臂、左右腿外展、躯干左倾。

在 media 的真实白模 rig 上执行后：

- 各夹具投影 RMSE 为 `0.0577–0.0660`。
- 上臂方向误差约 `10°–15°`，没有出现左右反转或 180° 翻转。
- 大腿方向误差约 `0.5°–11.2°`，左右外展仍有可见残差。

这说明当前左右侧映射和基本坐标方向在人工输入下可工作，但尚不能证明源视频姿态的深度、相机朝向或连续动作求解正确。

## 复现命令

```bash
python3 -m py_compile tools/motion_track/render_single_frame_validation.py
scp tools/motion_track/render_single_frame_validation.py ubuntu@media:/tmp/render_single_frame_validation-baseline.py
ssh ubuntu@media '/opt/blender-4.5.9/blender -b --python /tmp/render_single_frame_validation-baseline.py -- \
  --source-blend /home/ubuntu/director-deploy-r2/assets/characters/white-model-neutral-female-v1/blender/white-model-neutral-female-v1.blend \
  --manifest /tmp/single-frame-manifest-raw.json \
  --output /tmp/single-frame-validation-baseline \
  --depth-mode flatten --no-render'
```
