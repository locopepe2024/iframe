# 复刻系统需求与进度 Review v1

## 1. 产品分线

复刻不是一个单一能力，应拆成两个产品工作流：

### A. 电商商品复刻

```text
原视频
→ 分段/剧本/商品位置分析
→ 商品图片绑定
→ 商品替换生成
→ 字幕/口播/配音处理
→ 本地组装和验收
```

目标偏静态：保留原镜头、人物动作、商品出现时机和场景结构，主要改变商品外观、可见文字、字幕和声音。

### B. 动作复刻

```text
原视频
→ 目标人物选择
→ 2D/3D 姿态和轨迹
→ body-local 坐标系
→ 骨骼 rig 重定向
→ IK/脚部接触/动作清理
→ 白模动作视频
→ H3/Seedance 参考视频
```

目标偏动态：保留人物动作、节奏、朝向、躯干和脚部关系，人物外观可以替换。

## 2. 电商商品复刻 Review

### 已完成 / 有代码和测试证据

- 项目、源视频、参考帧、替换图片按 owner 作用域保存。
- 分段和剧本 revision 有持久化和过期校验。
- 商品替换图片有明确 `replacement_image` 角色。
- H3 商品替换 prompt 使用 `<Video 1>`、`<Picture 1>`、`<Picture 2>` 的显式输入角色。
- 复刻生成路径固定为已验证的 `uniart/minimax-h3-vip`，其他模型不会因为 catalog 存在就自动放行。
- 任务创建前保存源视频/图片 fingerprint。
- 上游 task ID 持久化，避免 worker 中断后重复付费提交。
- 已实现 `silent`、`generated`、`preserve_source` 三种音频策略。
- 生成结果可进入本地 FFmpeg 组装，并保存为 owner-scoped `final_video`。
- 已测试短视频、替换图片、H3 `reference2video`、720p/16:9 请求契约。

### 部分完成

- 商品替换主要依赖 H3 参考视频重新生成，不是逐帧像素级编辑。
- 商品位置、遮挡、手持关系在 prompt 中有描述，但缺少独立的视频级商品 mask/跟踪校验。
- 字幕和配音目前不是完整的复刻子系统：
  - 有通用 TTS/voice 能力；
  - 有 audio policy 和 prompt 声音描述；
  - 但复刻流程没有完整的 ASR artifact、字幕时间轴、逐句替换审核和配音对齐产物。
- 当前按用户要求暂不处理 ASR、字幕 artifact 和独立 TTS，因此这些应标记为延后项，而不是已完成能力。

### 未证明

- H3 是否逐帧保持原商品的真实运动轨迹。
- H3 输出是否稳定保持手部遮挡和商品朝向。
- 重新生成的配音是否与原视频口型、节奏和字幕时间严格同步。
- 商品替换是否能覆盖快速运动、严重遮挡和多商品场景。

### 当前适合的产品定位

电商复刻当前可称为：

> 基于参考视频和商品图片的结构化视频再生成。

不能称为：

> 原视频商品的精确局部编辑或逐帧替换。

## 3. 动作复刻 Review

### 已完成 / 有运行证据

- 三人物测试视频已经支持目标人物选择和中心人物 track 记录。
- `motion-track.v1` 已包含：
  - semantic joints
  - confidence
  - source frame/timestamp
  - hip/shoulder center
  - pelvis/shoulder axis
  - foot targets
  - foot contact candidates
  - occlusion/status
- media 主机已经安装 Blender 4.5.9 和白模 rig。
- 已能从 track 生成 Blender state。
- 已完成多个代表帧的 Blender 白模静帧和短视频渲染。
- 已读取并确认白模真实 rig 的骨骼和 rest 轴：spine Z、upper arm X、upper leg -Z、foot -Y。
- 已完成 raw 与平滑轨迹对照，确认单帧必须使用 raw track。
- 已检查 Kinovea、Rokoko、3dPoints2Blender、MediaPipe、MMPose/RTMPose、VideoPose3D、ROMP、4D-Humans 等可自部署或可参考项目。

### 部分完成

- 当前 Blender 适配仍处于单帧坐标校准阶段。
- 2D 关键点到 3D 的深度主要来自单目相对估计，不能视为真实深度。
- spine 分段目前是 hip/shoulder 几何代理，不是真实腰椎 landmark。
- 当前还没有完整可用的 pelvis/root 分离、全身 local quaternion、脚部 IK、膝盖方向约束和动作清理链。
- 单帧验证器曾经存在闭环测量问题：直接写入 evaluated bone matrix 后再读取，导致 0° 误差。这只能证明矩阵闭环，不能证明视觉准确。
- 当前更可靠的验收应该是 Blender 投影关节点与源视频 2D 关节点的独立误差。

### 未完成

- 真实 3D 躯干分段姿态。
- 稳定快速转身的 root yaw。
- 多人物长期跟踪和遮挡恢复。
- foot contact gate 和 IK 锁定。
- 完整可编辑 `full_motion.bundle`。
- 白模动作达到可用于 H3 的可信标准。

### 当前不能称为

> 已完成动作复刻。

当前更准确的描述是：

> 已完成目标人物 2D/相对 3D 轨迹到 Blender 白模的实验性验证链，正在进行单帧坐标和骨骼重定向校准。

## 4. 两条线的边界

| 能力 | 商品复刻 | 动作复刻 |
|---|---:|---:|
| 原视频/分段/剧本分析 | 核心 | 输入基础 |
| 商品图片替换 | 核心 | 非核心 |
| 人物身份替换 | 可选 | 核心目标之一 |
| 2D 姿态提取 | 非核心 | 核心 |
| Blender rig | 非核心 | 核心 |
| 字幕/ASR/配音 | 延后但需要独立子系统 | 非核心，可后处理 |
| H3/Seedance 参考视频 | 当前生产路径 | 最终消费端 |
| FFmpeg 组装 | 已有 | 用于白模/参考视频输出 |

## 5. 优先级建议

## 5.0 阶段门决策

当前采用严格串行阶段门：

```text
完整动作复刻能力
        ↓ 通过动作验收
电商复刻字幕/ASR/音频能力
        ↓
动作复刻字幕/音频能力
```

在动作复刻未通过代表帧、短片段、转身、落地和脚部验收前，不扩展字幕、ASR、独立 TTS 或动作复刻音频编排。原因是动作参考视频仍是当前复刻系统的主要技术风险，先稳定动作中间层和白模参考，后续音频能力才能复用稳定的时间轴和镜头分段。

### P0：稳定商品复刻交付

1. 保持 H3 720p、16:9、`reference2video` 请求契约。
2. 完成商品替换结果的人工验收清单：商品身份、位置、遮挡、手持关系、镜头和时长。
3. 保持音频策略显式，不把 generated/reference/silent 混用。
4. 暂不把字幕、ASR、独立 TTS 宣称为完成能力；它们排在完整动作复刻之后。

### P1：完整动作复刻单帧校准

1. 使用 raw track，不使用平滑 track。
2. 使用 Blender evaluated bone endpoints 投影回 2D，计算独立投影误差。
3. 对比 flatten depth、MediaPipe depth 和 CPU 深度模型。
4. 校准 rest pose 到 body-local frame 的 local quaternion。
5. 优先修正肩、上臂、髋、大腿、躯干朝向。

### P2：完整动作复刻短片段和连续链

1. 2～3 秒短片段连续重定向。
2. quaternion sign continuity。
3. 脚部接触候选和 IK fallback。
4. 膝盖方向、髋部开合、落地和转身验收。

### P3：参考视频和模型 A/B

1. raw white-model reference。
2. smooth white-model reference。
3. depth-assisted reference。
4. 相同源视频、相同人物图、相同分辨率下比较 H3/Seedance。

### P4：字幕、ASR、音频和配音补齐

只有 P1～P3 的动作复刻通过后，才进入该阶段：

- 源视频 ASR artifact 和可编辑字幕时间轴
- 字幕替换、字幕样式和烧录/外挂策略
- 原音、静音、生成音频、参考音频的统一契约
- 口播文本到 TTS 的时间对齐
- 角色/说话人/音色绑定
- 动作复刻参考视频与字幕、配音、音效的最终组装
- 电商商品替换和动作复刻共用的音频验收

## 6. 测试计划

### 商品复刻测试

- 静态商品、单镜头、无快速遮挡。
- 商品手持移动。
- 商品部分遮挡。
- 多人物但只替换商品。
- 原音保留、静音、生成音频三种策略。
- 输出时长、画幅、音频流、商品身份和镜头结构检查。

### 动作复刻测试

- 帧 1：初始姿态和朝向。
- 帧 60：跳跃早期。
- 帧 120：双臂展开。
- 帧 150：旋转/空中姿态。
- 帧 180：落地或转身。
- 帧 240、360、480、556：补充姿态。

每个测试同时保存：源帧、raw joints、body frame、Blender 静帧、投影误差、人工结论。

### 当前投影验证结果

使用 raw `motion-track.v1` 的 9 个代表帧，在 media CPU Blender 上完成了独立投影验证。相似变换只消除相机 framing 和 rig scale，不消除关节点相对布局错误。

| 深度模式 | 平均归一化 2D 投影 RMSE |
|---|---:|
| flatten depth | 0.0463 |
| MediaPipe estimated depth | 0.0449 |

**Observed**：两种模式差异很小，estimated depth 只略优于 flatten depth。

**Direct implication**：当前最大误差不应继续归因于深度插件；应优先检查 source 2D 关键点、相机投影、骨骼父子局部旋转和人体朝向。

**Not yet proven**：该 RMSE 尚未设定最终产品阈值，也未覆盖快速旋转的连续时序和脚部接触。

**Retargeting boundary**：一次 world-space 直接覆盖 pose bone matrix 的实验导致子骨骼重复继承父级旋转，出现前臂和小腿交叉。该路径已撤回；当前继续使用父子链中的 local swing，并把 `clavicle → upper_arm → lower_arm` 作为下一轮校准顺序。

### 逐段方向诊断

独立投影报告增加了相似变换后的逐段角度误差。当前 raw/estimated-depth 代表帧平均绝对角度误差约为：

| 骨段 | 平均绝对角度误差 |
|---|---:|
| upper arm L | 15.31° |
| lower arm L | 13.69° |
| upper arm R | 12.75° |
| lower arm R | 10.18° |
| upper leg L | 8.63° |
| upper leg R | 6.31° |
| lower leg L | 5.90° |
| lower leg R | 6.56° |

**Observed**：上臂和前臂误差明显高于腿部，肩/臂局部轴或肩胛/锁骨处理是下一处高风险边界。

**Direct implication**：下一步优先校准 `clavicle_l/r → upper_arm_l/r → lower_arm_l/r` 的父子局部旋转；不要先扩大深度模型或时序平滑范围。

## 7. 成功标准

### 商品复刻

- 指定商品被替换，其他商品不误替换。
- 商品跨镜头保持身份和外观一致。
- 手持、遮挡、光照、运动模糊基本合理。
- 镜头数量、结构、时长和画幅符合源视频。
- 音频策略和实际输出一致。

### 动作复刻

- 代表性单帧中左右肢体方向正确。
- 髋、肩、脊柱和大腿方向与源帧一致。
- 跳跃、旋转、落地动作可辨认。
- 不持续背向错误方向。
- 不出现明显脚部穿地、膝盖反折或手臂脱节。
- 通过独立投影误差和人工视觉验收后，才进入 H3/Seedance A/B。

## 8. 当前结论

商品复刻已经具备可测试的 H3 结构化再生成链，主要风险是生成结果的一致性和字幕/配音子系统尚未接入。字幕、ASR、音频补齐放到完整动作复刻通过之后。

动作复刻已经具备数据契约、目标人物跟踪、Blender rig 和白模实验链，但还没有达到“可靠动作复刻”。当前最重要的工作不是继续调 prompt，而是完成单帧 body-local 坐标、骨骼 rest pose 和投影误差验证。
