# MediaPipe world pose 源人体透视相机拟合隔离实验

## 目标

在不改主 builder、提取器、renderer、rig 或 H3 输入的前提下，检验同源 MediaPipe `pose_world_landmarks` 能否通过一个固定方向的针孔相机和逐帧 root translation 更好地解释对应的 image landmarks；同时判断焦距与绝对 root 深度是否能由现有数据稳定识别。

## 输入与固定边界

- 使用 2026-10-21 同源 world/image sidecar 与源 PTS 映射；只保留双方都存在的 16 个语义关节，visibility 阈值沿用 0.2。
- 画幅固定为 1394×792，主点候选固定在画幅中心，像素长宽比固定为 1，镜头畸变固定为 0。
- 静态相机方向从源帧 1–53 的既有弱透视拟合初始化，只允许用同一校准窗做一次共享旋转的小范围细化；不得用目标 rig、渲染误差、鞋底或 H3 输出反向调参。
- 每帧仅拟合三个 root 平移参数；world landmarks 的髋中心为局部原点。全局焦距只由源帧 1–53 选择，后段只作留出验证。
- 比较同一批点上的逐帧弱透视拟合与针孔拟合；输出焦距 profile、逐帧深度、可见性加权 RMSE、分位误差和分关节残差。

## 成功条件

- frame/PTS 配对、landmark 选择、图像尺寸和输入哈希均可复核；不得因重拟合改变目标帧集合。
- 训练帧确定的全局焦距和静态方向在后段留出帧上相对弱透视基线有可重复改善，且不是由少数低置信关节主导。
- 如焦距 profile 在宽范围内近似平坦、最优值压在搜索边界，或 depth 随 focal 近比例漂移，则报告深度/焦距不可辨识，不得把单一拟合深度解释为实测绝对 root。
- 即使源层通过，也只证明该模型输出与针孔投影的一致性；不等于独立 3D 真值或目标 rig / 支持脚通过。

## 本轮不做

- 不替换 `pose_landmarks`/`pose_world_landmarks`，不改 motion track 或生产 bundle。
- 不接入 pinned rig，不解鞋底、地面接触、IK、骨盆/胸廓旋转或目标比例。
- 不把同一 MediaPipe 模型输出的 image/world 互相拟合称作独立验证。

## 报告路径

- 原始数值：`docs/agents/raw/2026-10-22-world-camera-fit/`
- 复用工具：`docs/agents/tools/recreation2_world_perspective_fit.py`
- 面向复核的结论：`docs/agents/deliverables/2026-10-22-recreation2-world-perspective-camera-fit-v1.md`
