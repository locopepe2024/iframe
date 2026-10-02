# 可自部署动作采集候选矩阵 v1

## 筛选边界

只纳入公开 GitHub、可在自己的主机安装和审计的项目。友商官网 SaaS、登录后 API、商业 Blender 插件不作为当前测试依赖。

## 候选分级

| 项目 | 可自部署 | 主要输出 | CPU media 适配 | 当前结论 |
|---|---|---|---|---|
| MediaPipe Pose/Holistic | 是 | 2D/相对 3D 关键点 | 高 | 现有基础层，继续保留 |
| MMPose / RTMPose | 是 | 2D 关键点、部分 3D 模型 | 中 | 作为 MediaPipe 对照和漏检恢复候选 |
| VideoPose3D | 是 | 基于 2D 序列的相对 3D 关节 | 中低 | 适合作为 CPU 3D 姿态实验，不保证快速旋转 |
| ROMP | 是 | 单目 3D 人体/SMPL | 低 | GPU 优先，media CPU 仅做离线可行性验证 |
| 4D-Humans | 是 | HMR/SMPL 类 3D 人体 | 低 | GPU 优先，不作为当前 media 主链 |
| 3dPoints2Blender | 是 | MediaPipe/Rokoko/Plask 数据到 Blender | 高 | 作为导入和 Blender 编排参考 |
| sl-animation-blender | 是 | MediaPipe Holistic 到 Blender 动画 | 高 | 作为 CPU/Blender 对照实现候选 |
| Rokoko Studio Live Blender | 部分 | Blender 实时输入、骨骼映射、retarget | 中 | 代码可审计，输入依赖 Rokoko 数据，不作为采集器 |
| x6ud/controlnet-render-blender-addon | 是 | Blender normal/depth/edge 渲染 | 高 | 只能生成参考图，不能从视频提取人体深度 |
| Auto-Rig Pro | 否，商业插件 | 自动绑定、retarget、FBX | 高 | 不纳入自部署依赖，只借鉴设计 |
| Plask | 否，SaaS | 视频到动作 | 不适用 | 排除 |
| DeepMotion | 否，SaaS | 视频到动作 | 不适用 | 排除 |

## 推荐自部署路线

### CPU 第一阶段

```text
MediaPipe Pose/Holistic
→ 原始 motion-track.v1
→ 单帧人工复核
→ body-local frame
→ Blender rest-pose retarget
```

### CPU 3D 对照

```text
MediaPipe 或 RTMPose 2D 序列
→ VideoPose3D
→ 相对 3D 轨迹
→ Blender retarget
```

VideoPose3D 的深度和尺度仍是相对值，不能直接视为真实世界坐标。快速转身、遮挡、脚部接触需要单独验证。

### 深度辅助

单独测试 MiDaS/Depth Anything 等公开深度模型时，只把深度作为前后关系和遮挡证据；不要让它直接覆盖 2D 关键点或决定全部骨骼旋转。

## 当前不采用

- Plask、DeepMotion：无法作为自部署依赖。
- Auto-Rig Pro：商业插件，不符合当前自部署边界。
- ControlNet Blender addon：只能从 Blender 场景生成 depth/normal/edge，不能替代视频人体深度估计。
- 4D-Humans、ROMP：先不放入 media 主链，除非 GPU 环境或离线机器验证通过。

## 验证顺序

1. raw MediaPipe 单帧坐标验证
2. MediaPipe 连续轨迹与脚部接触
3. RTMPose 对照漏检和抖动
4. VideoPose3D CPU 3D 对照
5. 深度模型只做前后方向辅助
6. 通过单帧和短片段后，再接 H3/Seedance 参考视频

## 证据边界

当前公开仓库资料只能证明项目存在相应代码或接口，不能证明它们在本测试视频上能稳定恢复舞蹈动作。每个候选必须使用同一组代表帧和同一套 Blender 投影误差报告验证。
