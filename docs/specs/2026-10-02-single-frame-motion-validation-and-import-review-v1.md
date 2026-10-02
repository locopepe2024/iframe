# 单帧动作验证与动作导入方案评审 v1

## 目标

先验证单个姿势的坐标系、身体朝向和骨骼局部旋转，再恢复连续时序。单帧验证通过前，不把长视频渲染结果视为动作复刻成功。

## 当前证据

### Kinovea

**Observed（代码/项目文档）**

- Kinovea 是开源视频运动分析和标注工具，支持逐帧播放、关键帧、角度和距离测量、轨迹、坐标系/平面校准以及 CSV/表格导出。
- 代码和变更记录包含 trackable drawings、trajectory analysis、coordinate system、plane calibration、key image 和 XML/CSV 导出。

**Direct implication**

- 可借鉴其“原始帧 + 人工测量 + 关键帧证据”的复核流程。
- 它可以帮助确认肩轴、髋轴、肘膝角、脚尖方向和画面朝向，但不会自动生成可靠的 3D 骨架或 Blender retarget 数据。

**Not yet proven**

- Kinovea 输出的 2D 测量不能直接证明真实深度、腰椎分段姿态或旋转轴方向。

### Rokoko Studio Live Blender 插件

**Observed（公开仓库 `Rokoko/rokoko-studio-live-blender`，commit `b031e5a`）**

- 插件用于把 Rokoko Studio 的实时动作数据流入 Blender。
- 包含 actor bone auto-detection、T-pose 保存、source/target armature retargeting、bone list、scale 和动画重定向逻辑。
- README 明确要求源/目标骨架姿势一致，并提供基于骨骼映射的 retarget 流程。

**Direct implication**

- Rokoko 可作为“已有骨骼动画 → 白模 rig”的重定向参考，特别是 rest pose、bone mapping、局部旋转和 T-pose 校准。
- 它不能替代本项目的视频关键点提取；视频仍需要先生成骨骼或动作数据。

**Not yet proven**

- 当前白模的 MediaPipe/CPU 轨迹能否直接满足 Rokoko 的输入协议，尚未验证。
- Rokoko 的自动映射不能自动恢复当前缺失的真实腰椎观测和快速旋转深度。

### HiMotion

**Observed**

- 当前公开 GitHub 查询没有找到可确认的、与本项目输入输出直接对应的 HiMotion Blender 导入仓库或稳定动作文件契约。

**Direct implication**

- 在找到官方仓库、论文实现或明确导出格式前，不能把“HiMotion 动作生成/导入”当作已验证能力。
- 若 HiMotion 能输出 BVH/FBX/GLB 或标准关节轨迹，它可以作为动作生成器或 source armature；导入后仍需经过 rest pose 校准和目标 rig 重定向。

**Hypothesis**

- HiMotion 若提供全身骨骼动画，可能比当前仅有 2D/相对深度的轨迹更适合作为 Blender 白模 source animation；这需要实际样例和格式验证。

## 单帧验证实现

新增：

- `tools/motion_track/build_single_frame_validation.py`
- `tools/motion_track/render_single_frame_validation.py`
- `artifacts/motion_review/white-model-20261001/single-frame-validation/`

验证帧：`1, 60, 120, 150, 180, 240, 360, 480, 556`。

每帧输出：

- 原始视频帧
- Blender 白模静帧
- 适配器帧号
- 骨骼方向误差报告

当前报告只证明“单帧输入经过当前适配器后，Blender 产生了一个可渲染姿势”。它不证明连续动作、动态 root yaw、真实 3D 深度或腰椎观测准确。

## 当前单帧运行结果

media CPU Blender 已完成 9 帧渲染。方向误差汇总如下：

| 源帧 | 平均方向误差 | 最大方向误差 |
|---:|---:|---:|
| 1 | 62.27° | 136.50° |
| 60 | 39.89° | 88.12° |
| 120 | 70.73° | 174.07° |
| 150 | 51.27° | 142.11° |
| 180 | 50.05° | 155.66° |
| 240 | 31.69° | 87.19° |
| 360 | 45.32° | 98.47° |
| 480 | 42.21° | 115.93° |
| 556 | 37.18° | 86.03° |

## 结论

**Observed**：单帧渲染链已打通，但多数骨骼方向误差仍较大，接触纸面上的白模姿势不能作为动作复刻通过标准。

**Direct implication**：下一步应先修正 body frame、骨骼局部轴和 rest pose 映射，优先检查肩/上臂、髋/大腿和躯干朝向，再恢复时序平滑和动态旋转。

**Hypothesis**：当前误差主要来自“源向量在图像/世界坐标中计算，目标骨骼却按旧的平面 Euler 局部轴写入”，而不是单纯抖动问题。

## 下一步

1. 在 Blender 中读取真实 rest bone head/tail，建立每根目标骨骼的局部基准轴。
2. 把源段向量转换到 body-local frame，再求目标 bone-local quaternion。
3. 用单帧报告把平均方向误差降到预设阈值后，再验证连续片段。
4. 再评估 Rokoko retargeting 是否可复用为目标 rig 的重定向层。
5. HiMotion 只有在拿到真实动作文件/协议后才进入适配器评估。
