# s09：深度/姿态预处理与 H3 Ref2VA 工作流边界

日期：2026-10-17。范围：把用户提出的“原视频 + 人物图 → 可选 Depth Anything / DWPose / OpenPose → H3 Ref2VA → 24 fps 输出”与当前 iFrame/UniArt 链路和 s09 运行结果对照。公开 H3 提示词格式引用此前已核对的 [官方固定 commit 阅读记录](2026-10-16-h3-reference-generation-vs-video-editing-v1.md)；本轮没有新的网络读取或付费生成。

## Observed

- s09 源片 120 帧、30 fps、4 秒；正确目标人物图是 `枪法_4` 的 768 宽版本（SHA-256 `ba4e1a55…`）。B3R 已使用该图。输出 90 帧、24 fps、3.75 秒，人物仍主要为源片女性。[逐帧匹配](../raw/2026-10-11-qiangfa-cut-poc/s09-B3R-frame-match.json)显示输出 90/90 帧都与源片相同序号 ±1 帧最接近，导致源片后 30 帧（含前方展开与硬切）缺失。
- 当前 `src/models/uniart.py` 的视频请求 `content` 能发送文本、`reference_image`、`reference_video`、`reference_audio`，并传 `model/mode/duration/resolution/ratio/generate_audio/seed` 等字段。当前路径没有为 H3 发送 `depth`、`pose`、`ControlNet` 或输出 `fps` 的已实现字段。这是**iFrame 当前代码事实**，不是对所有 ComfyUI 节点或 H3 原厂能力的断言。
- 当前 H3 Ref2VA 六段提示词为 `subject_definitions`、`summary`、`retention_analysis`、`detailed_description`、`overall_soundscape`、`non_diegetic_music`。用户草案中的 `retained_elements` 可作为语义说明，但不是当前已核对的段名；保留关系应写在 `retention_analysis`。本地 `scripts/check_h3_prompt.py` 也按这六段检查。
- “H3 原生 24 fps”在本轮可直接确认的是**返回视频**为 24 fps；当前请求没有设置 `fps`。不能从返回媒体元数据推出模型内部固定帧率或 ComfyUI 节点配置要求。

## Direct implication

| 阶段 | 当前 s09 可执行做法 | 验收边界 |
|---|---|---|
| 素材冻结 | 固定 4 秒源片和 `枪法_4` 目标图的路径、哈希、帧率、时长 | 提交记录必须同时写明**预期目标图**和**实际上载图**的哈希；避免 A/B/B2/B3 的错误图重演 |
| 源视频分析 | 提取源帧证据表、动作相位、枪端、遮挡、切点；Depth Anything / DWPose / OpenPose 可作为额外观察通道 | 模型输出只能提候选；手、枪、红缨与快速边界须回到原帧复核；二维骨架不能代表枪的刚体几何 |
| 时间基准备 | 在本地先验证 30→24 fps 的事件映射；已有 96 帧/4 秒的模拟输入，前 90 帧覆盖源片完整事件 | 模拟只证明本地帧位；未证明 H3 会按该映射生成，也不能自行算作 H3 质量改善 |
| H3 请求 | `reference_image` 为目标人物，`reference_video` 为源动作；使用已核对六段 Ref2VA 格式及明确的替换/保留关系 | 当前 UniArt 路由没有已验证的深度/骨架硬控制输入；ComfyUI 预处理节点存在不等于 H3 会消费其图 |
| 输出验收 | 先看人物替换、事件存在与顺序、帧对应，再看节奏、枪几何、背景/UI 杂质 | 若输出为源片同序号复制，应直接判身份/动作复刻失败；不得因“运镜保真”掩盖主体没有替换 |

## Not yet proven / Hypotheses

- Depth Anything 或 DWPose/OpenPose 结果能作为当前 H3 Ref2VA 的直接控制信号：**未验证**。可能用于分析、提示词编制或另一模型/工作流；不能把通用 ComfyUI 预处理节点等同于 H3 ControlNet 能力。
- “H3 对 V2V 动作迁移支持极好、直接丢原视频即可高保真换人”：属于外部性能主张，本片正确目标图的 B3R 结果不支持把它当作当前链路的已验证能力。
- ComfyUI 比官方 API 更适合本任务，或允许设置 H3 内部/输出 fps：未核对具体节点和后端参数。
- 源视频 30 fps 与输出 24 fps 的同序号映射发生在模型、UniArt 预处理或结果编码的哪一层：未定位。

## What would verify it

1. 对计划使用的**具体** H3 ComfyUI 节点或 API schema 检查是否接受 depth/pose 控制媒体、角色和时间同步字段；没有明确契约时只把它们用作离线分析材料。
2. 对本地 24 fps 时间基模拟做输出验证时，冻结正确人物图、B3 提示词和 seed；只改变源视频时间基，检查是否仍出现同序号近复制、是否覆盖源片帧 99–119、身份是否替换。该步会产生新的付费任务，须单独授权。
3. 若时间覆盖改善而人物仍失败，再单独验证身份替换机制（如直接编辑任务语义、人物遮罩/背景处理或其他已确认支持的模型入口），不要把深度/姿态图一并加入，保留可解释性。
