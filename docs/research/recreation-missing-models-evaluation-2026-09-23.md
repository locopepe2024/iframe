# 复刻工作流缺口模型评估

日期：2026-09-23

状态：基于本地代码与契约文档的候选评估；未做供应商控制台查询或真实付费模型验收。

当前范围决策：首期先使用 MiniMax H3、ASR 1.0、Speech 2.8，并推动 UniArt 对接 GlobalAI 去字幕；SAM 2、Cutie、XMem、ProPainter、E2FGVI-HQ、STTN 均不在首期实施范围。下文对跟踪/补洞的讨论仅用于未来评估，不表示已有接入或当前必须采购。

## Observed

- iFrame recreation 已有 MiniMax H3 视频生成路径、GPT Image 2 关键帧编辑路径，以及使用整数源 PTS 的本地抽帧/镜头候选逻辑。
- UniArt 源码包含 MiniMax `speech-2.8-hd`、`speech-2.8-turbo` 和 `asr-1.0` 适配。MiniMax onboarding 文档明确了 TTS/ASR endpoint 形状；ASR 适配请求支持 sentence/word timestamp level 与 JSON/SRT/VTT 等输出。但 UniArt 文档仍把生产 capability/pricing/canary 列为待闭环事项；iFrame recreation 没有 ASR/TTS Run 接入。
- UniArt 有 GlobalAI `sd2ManxueRemoveSubtitle` 的独立协议和确定性请求/查询/结果测试。onboarding spec 将其标为 hidden upstream inventory；公开 SKU/用户价格未批准。契约摘要称其 OCR 针对中英文字幕、最高输入 2K、超 1080p 默认输出 1080p；价格、最大时长/文件大小与真实移除质量未知。
- iFrame 漫剧配音代码预热并调用 Demucs `htdemucs`，输出两 stem 的 `vocals` 与 `no_vocals`，用于配音预览保留背景声。失败时现有调用路径允许 fallback 到简单替换；这不是 recreation 的 owner-scoped 分离任务，也不是 vocals/music/ambience 三 stem 输出。
- iFrame 有 Qwen-VL 图片提示处理封装，使用单个参考图构造多模态 prompt。漫剧 LLM 可构造多个 image_url 输入，但 recreation 没有视频级视觉理解任务/结果 schema；图像输入不等于连续视频理解。
- 本地没有发现 recreation 接入 speaker diarization、视频目标跟踪/分割、时序视频修复/补洞或专用音频场景描述任务。

## Direct implication

- 标准路径“ASR 转录草稿 + 独立 TTS 配音”不需要先买/接另一种基础模型：现有 MiniMax ASR/TTS 型号已覆盖模型类别，先做 recreation 适配、时间基准转换和样片验收。
- `sd2ManxueRemoveSubtitle` 不属于待寻找的未知模型；它是优先做受控验证的现成候选。它处理源片烧录字幕，不保证生成结果绝不带字，也可能损坏产品包装/场景内真实文字。
- `htdemucs` 不应计为“缺一个分离模型”，但应计为“复刻域尚缺已验证、可恢复、可追溯的分离工作流”。现有两 stem 只能支撑“保留非人声混合背景 + 替换对白”的初步尝试，不能承诺独立保留音乐、环境声和效果声。
- 当前 Qwen-VL 能作为抽帧描述/文字候选识别的技术试验，不足以标成视频理解模型。对时间连续的动作/运镜理解，需要带时间戳的多帧分析评估，或另找有明确视频输入契约的模型。
- 从稀疏关键帧编辑升级到逐帧替换，主要缺的是跨帧 instance mask/tracking、背景补洞和 temporal consistency，不是再加一个普通图像生成模型。
- ASR word timestamps 应先作为 TTS 字幕/台词对齐的 baseline。除非时间误差在验收集上超标，不应先接专用 forced aligner。

## Not yet proven

- `sd2ManxueRemoveSubtitle` 的通用调用代码可用，不证明生产路由、成本、任务时限、输出分辨率和中英字幕移除质量适合本项目。
- 现有 Demucs 路径不证明模型依赖在 recreation worker 环境稳定安装，也不证明 VFR 视频裁剪后音频 PTS 对齐、失败行为、并发资源占用和音质满足产品要求。
- 对 Qwen-VL 批量发送抽帧能否可靠恢复镜头顺序/运动，尚无 recreation 质量数据。时间戳写入文字 prompt 不能让图像模型变成真正的视频编码器。
- 没有样本集支撑 diarization、source separation、字幕检测/OCR 或逐帧替换模型的准确率、成本和耗时比较。

## Candidate assessment

| 缺口 | 候选 / 已有资产 | 优先级 | 结论 |
| --- | --- | --- | --- |
| 转录与配音 | MiniMax `asr-1.0` + Speech 2.8 HD/Turbo | P0 | 型号类别已齐；集成 iFrame recreation 的双独立 Run、owner media、PTS 时间戳、用户确认、费用和 TTS 结果对齐。HD 可作为最终配音候选，Turbo 作为显式预听档，质量优劣需盲测。 |
| 源片去烧录字幕 | GlobalAI `sd2ManxueRemoveSubtitle`（由 UniArt 对接） | P0 对接与验收 | iFrame 当前未对接。完成 UniArt 暴露能力后，再做可选的源视频预处理 Run；先验收价格、最长时长、实际分辨率和中英文字幕样本，并提供清理预览。未验收前不能默认为所有源视频自动调用。 |
| 说话人分段 | 单独 diarization 能力，或有 speaker ID 输出的 ASR | P2 条件性 | 多人对白/角色配音才需要。MiniMax ASR 当前接入适配不建立 speaker schema；不要仅按停顿或音色描述伪造稳定说话人身份。首轮先由用户编辑 speaker 标签。 |
| 背景声保留/对白替换 | iFrame 已有 Demucs `htdemucs` 两 stem 路径 | P1 POC | 优先复用并抽离成 recreation-owned 分离 Run，不采购第二个 separator。显式输出 `vocals` 与 `no_vocals`、保留源指纹/PTS、禁止静默 fallback；明确 `no_vocals` 仍是音乐/环境声混合轨。若要分别编辑音乐/环境/音效，再评估 4-stem 或音频事件分离模型。 |
| 镜头内容描述 | Qwen-VL 图像调用、多帧输入试验；或经过验证的视频理解模型 | P1 试验 / P2 产品化 | 小样先比较“单代表帧、多带 PTS 帧、整段视频输入”三种模式。没有时间对齐与动作描述评测前，只用于可编辑建议，不自动确认 Story。只有整段视频协议、最大时长/帧数、费用与时间信息都清晰时，才采购/公开 video-understanding SKU。 |
| 烧录文字检查 | `sd2ManxueRemoveSubtitle` 的候选清理 + 现有视觉模型抽帧 OCR 试验 | P1 QC | 删除前先检测和人工确认区域；输出后抽帧复查。OCR/字幕清理不能证明“无任何文字”，包装印刷/场景招牌与字幕需分类，保留误删恢复/人工复核。单独 OCR 库属于系统组件，不必要求生成模型 SKU。 |
| 连续逐帧替换 | SAM 2 / Cutie / XMem + ProPainter / E2FGVI-HQ / STTN（未来候选） | 延后 | 这些模型当前均未接入，不纳入首期。只有在关键帧编辑验证出明确需求后，再做 10-30 秒 POC，评估 mask 稳定性、遮挡恢复、补洞闪烁、许可、GPU 资源和成本；此前只提供清楚标注覆盖范围的关键帧编辑。 |
| 字幕/语音强制对齐 | ASR `word` timestamp baseline；超标后再选 forced aligner | P3 | 不需要新的字幕生成模型。先量测 ASR 识别式时间戳与已确认文本的边界误差；TTS 输出可重新 ASR 对齐并人工修正。固定稿对齐若误差不达标，再评估专用 forced aligner。 |
| 音频事件/声音风格理解 | 暂无 recreation 级已验证模型 | P3 | 首版使用人工声音描述 + 独立原声/静音/TTS 选择即可。若产品要自动总结环境声、音乐节奏/情绪、音效事件，再评估音频 captioning/audio-language 模型；不能把 ASR 文本或 H3 生成音频当成 source audio understanding。 |
| 人声音色克隆 | 需单独验证现有 MiniMax voice-clone/runtime 契约 | P3 条件性 | 若仅新配音，系统音色即可；若明确要复刻原说话人音色，需要同意/权利流程、音色创建状态、首次使用费用和可撤回资产治理。Speech 2.8 TTS SKU 本身不证明 voice clone 已开通。 |

## Hypotheses

- 若多数参考片只需复刻整体运动而非干净分轨，则首版不需要新增 source-separation 模型：ASR/TTS + 原声/静音/视频模型音频三条路径足够；此假设需用真实项目验证。
- 若最大用户痛点是输出视频带源字幕，则 GlobalAI 去字幕预处理的优先级高于完整音频理解模型；需通过包含产品包装文字、场景招牌、动态字幕和不同位置字幕的样本验证误删风险。
- 若关键帧逐帧路线要覆盖完整视频，mask propagation + video inpainting 可能比逐帧独立调用通用图像模型更稳定且成本可控；需 POC 对比，当前不视为已选架构。

## What would verify it

### 第一轮能力验收集

建立经授权的 10-20 个代表片段，包含：中英动态字幕、无字幕、产品包装有文字、场景招牌、两人轮流说话、音乐+对白、纯环境声、遮挡目标、镜头运动、切点邻近字幕。记录源视频 SHA-256 和标注；禁止将内容送到未批准 Provider。

### 验收指标

- ASR：中文 CER/英文 WER、词级时间边界误差、专有名词修订率、任务成本和时延。
- TTS：可懂度/自然度盲评、文本完整率、输出格式和单句时长变化、音量/峰值、单位文本成本。
- 字幕去除：人工判定残留字幕率、字幕区域外损伤率、包装/招牌误删率、真实输出分辨率、耗时和实际计费。未达到阈值时不自动提交。
- Demucs：人声泄漏到 `no_vocals`、背景损伤、时间长度/PTS 同步误差、CPU/GPU 峰值内存和超时；分离失败必须显式失败，不静默换轨。
- 视觉理解：镜头描述事实正确率、动作/运镜标签正确率、每条描述可追溯时间范围、字幕/包装文字区分 precision/recall。
- 逐帧路线：mask IoU/ID switch、遮挡恢复、边界闪烁、未覆盖帧比例、音画时长/PTS 偏差和每分钟处理成本。

### 发布门槛

1. 优先复用已有 MiniMax ASR/TTS、GlobalAI 去字幕和 Demucs 能力；新建 capability SKU 前先证明现有能力不能满足。
2. 所有新增 provider/model 都必须有精确 model ID、endpoint/protocol、限制、失败计费、价格 owner、请求/响应 fixtures 和成本确认。
3. 通过 mock 仅代表 request/state contract；发布前仍需一个成本受控 canary 和人工输出质量评估。
4. 未通过质量/费用门槛的能力保持隐藏或手动触发，不得自动 fallback 到另一模型/音轨策略。
