# 分镜 Skill 聚合、分层与去重 V1

状态：来源审计与设计决策候选；未改目录、加载或生成行为。日期：2026-10-23。

## Evidence scope

本轮复核 iFrame 的 `config/agent_skills/catalog.json`、`director-tasks.json`、`micro-expression-timing.md`、分镜字段模型和既有源码审计，并汇总仓库中先前阅读 GitHub 源码/文档留下的记录。外部项目的具体文件、版本及读取范围见文末来源。**本轮没有重新抓取上游最新版本**；外部结论只适用于各记录所列的已读版本。README、Skill 文本、数据 schema 和实际运行证据分别标注，不把目录存在当作效果证明。

## Observed：先聚合，不先命名

| 来源组 | 已读内容与证据 | 可提取的最小方法 | iFrame 当前状态 |
| --- | --- | --- | --- |
| iFrame 导演任务卡 | `director-tasks.json` 的导演分析、拍摄计划和四张 `storyboard-*` 卡；实际有阶段冻结 | 从原文拆镜、信息揭示、动作拆解、情绪镜头、对白/反应镜头 | 属上游镜头草稿；不能作为单镜首帧或视频润色卡再次加载 |
| iFrame 分镜 Skill 目录 | `catalog.json` 的 `director-style`、`seedance-camera`、`sequence-continuity`、`micro-expression-timing`、`seedance-prompt`、`minimax-h3-director` | 视觉意图、摄影/运镜、连续性、微表情、模型文本编译 | 前五个润色复选框仍把整段文本加载到最终润色；微表情有独立 JSON 合同，尚未成为普通润色项 |
| LeoYeAI/seedance-skills | 已读 camera、style、prompt-short、sequence、directing-engine；本地为 MIT 来源的自包含改编 | 摄影判断、整体导演意图、去冗词、跨镜状态 | 方法可分解；原 Seedance 名称与完整可复制提示词输出不能直接作为模型无关单镜 Skill |
| MiniMax 官方 H3 + AIMixer Director | 官方 H3 提示词与 base/ref 指南；AIMixer 是 ComfyUI 插件而非 Agent Skill | H3 模式/媒体/声音语法；可复用的动作可读性和素材用途判断 | 模式与语法留模型适配；通用方法抽出；插件参数不导入 |
| zenstory Drama Skills / Toonflow storyboard | 前者 README/DESIGN 与资产 Skill；后者 storyboard/workflow Skill 及源码边界 | 剧本→镜头→媒体阶段交接、身份/变体/瞬态分离、来源核对 | 作为阶段和输入约束；不复制成第二套 Markdown 权威数据或整包加载到单镜 |
| kangarooking Director Skills / 武指词典 | 前者 README 和 action-fight-prompt Skill；后者固定 commit 的 SKILL 与动作/风格词典 | 起势→接触→结果、重心/轨迹、动作与镜头的依赖、可检索词条 | 动作候选与词典分开；固定时长比例、强制特效/环境反馈不做全局规则 |
| 62656456 AI Film Skills | README、目录、wuxia-design Skill | 类型视觉知识与摄影、光色、空间、动作的分块交接 | 类型风格只作可选建议；不覆盖本镜已确认字段或资产 |
| production-pack / Pavo / OpenMovie / PromptKit | 已读 Skill/schema、部分 lint、Reviewer/Fixer 和版本合同 | 字段 schema、来源版本、连续性审阅、任务输出合同 | 主要是结构和校验对照，不能因为项目含 shot/camera 字段就认定有逐字段创作 Skill |
| timkoda seedance-skill / runapi hailuo / `seedance-2-5-fight-director` 示例 | 前者已读时未获明确许可；RunAPI 是 CLI/SDK 配方；最后一个不在当前目录 | 六层表达候选、调用配方、完整任务示例 | 不纳入创作目录；示例式“扩写成提示词”不能替代机位、节奏、转场字段决策 |

## Direct implication：按产出物和字段所有者分层

Skill 是**提供候选的方法**；已确认资产/分镜行是**数据**；H3/Seedance 适配是**编译**；lint、连续性诊断和模型能力校验是**审查/硬合同**。同一段外部 Skill 可提供多个方法素材，但不能因此成为跨阶段、跨字段的一个大 Skill。

去重以 `(阶段, 输入作用域, 可写字段, 输出合同)` 为判据：四项相同时合并方法并保留多个来源；只有术语相同而产物不同则保留分层。例如导演计划中的“机位”是上游建议，当前镜的 `camera_angle` 是待审设计值，H3 正文中的机位文字是编译结果，三者不是三个并列 Skill。词典负责提供可检索术语与案例，也不替代会输出字段候选的 Skill。对同一字段的多来源建议先合并成一项差异，列出冲突及依据，用户只采纳一次。

| 层 | 唯一产出物 | 方法/字段所有者 | 读取但不改写 |
| --- | --- | --- | --- |
| A. 故事与拍摄计划 | 已确认事件、场次、镜头任务、时空/连续性 ID | 导演分析与拍摄计划；从剧本拆镜时可选四张 `storyboard-*` 方法卡 | 原文、已确认资产；单镜设计不得重做剧情 |
| B. 来源与镜头基线 | 已确认角色/场景/道具版本、世界光、局部光、画幅、参考用途 | 对应资产和用户确认的结构化投影；镜头可有显式覆盖 | 前镜未获确认的动作、对白、角色描述 |
| C1. 当前镜动作/表演 | 动作起止和可见阶段、指定角色的微表情时序、特效与主体关系 | 动作设计、`micro-expression-timing`、特效可读性方法各写自己的字段 | 角色身份/服装、剧本事件、相机字段 |
| C2. 静态起幅 | `shot_size`、`camera_angle`、`composition`、视线/轴线及已审核的 `blocking` | 静态摄影/站位方法；首帧图只读 0.00 秒状态 | 运镜速度、跨镜切点、完整表情时序 |
| C3. 镜内摄影与时间 | `camera_movement_structured`、运动路径/速度、镜内节奏、转场候选 | 运镜与节奏/转场方法分别负责；落幅由起幅+运动结果核对 | C2 起幅、角色站位、既定动作终点 |
| D. 跨镜审阅 | 差异、冲突、来源和可采纳修正请求 | 连续性审阅；仅显式 ID 关联时比较允许的字段 | 不直接写 C1–C3；跨地点同时间只带世界光 |
| E. 模型编译 | H3 或 Seedance 的最终提示词、媒体映射、预览 token | 模型适配器和不可关闭的请求合同 | 只消费已采纳的 B–D，不反向决定景别/机位/动作 |

这种分层不要求每个字段单独运行一次模型：单次设计调用可联动动作、摄影和节奏，但返回值必须分字段、带来源和理由，且每个字段只有一个采纳位置。`blocking.stage` 表示主体间位置，`blocking.camera_relation` 是相机相对场景的静态起态；动态相机关系归 C3。当前 `CameraMovementData` 只有 `primary`、`secondary`、`speed`、`description`，路径和落幅尚无独立保存字段，不能把它们列为已实现能力。

## 去重决策表

| 重叠内容 | 聚合后的唯一归属 | 被移除的重复职责 |
| --- | --- | --- |
| `viewpoint-staging`、`storyboard-emotion`、`director-style` 都谈视点/景别 | A 决定镜头叙事任务；C2 才提本镜景别候选；`director-style` 只解释视觉意图或建议局部覆盖 | 不在 E 再改景别，也不让情绪卡自动重做镜头 |
| `seedance-camera`、H3 导演文本都谈机位与运动 | C2 负责起幅；C3 负责运镜；E 各自表达同一已确认值 | 不按目标模型各生成一套机位决策 |
| `storyboard-action`、武指 Skill、H3 动作可读性规则 | A 决定哪些动作需要拆镜；C1 设计本镜已有动作的起止与可见过程 | 不增加招式/事件，不在 H3 编译时补写新动作 |
| `storyboard-emotion`、`director-style`、微表情时序 | A 选择情绪镜头任务；C1 的指定角色微表情负责可见时序；风格建议仅提供意图 | 不把静态角色表情变成全镜时序，也不把时序写入首帧 |
| `sequence-continuity`、导演 `continuity-review`、参考图投影 | A 审阅拍摄计划；B 执行用户勾选的参考类别；D 审阅显式关联镜头的冲突 | 不用整段前镜提示词填当前镜；缺 ID 不猜 |
| `director-style`、类型风格卡、项目/场景风格 | B 保存基线；可选风格方法只提出当前镜有理由的覆盖；D 检查冲突 | 不把“电影感”或类型预设硬写入每镜 |
| `seedance-prompt`、H3 导演、图片提示词模板 | E 按目标模型/媒体分别编译已确认镜头；首帧图另取 C1/C2 起态 | 不共用 H3 标题，不把视频动作过程写进图片稿 |

## 聚合后候选目录及准入

| 候选用户名称 | 作用阶段 | 准入与状态 |
| --- | --- | --- |
| 从剧本拆镜：悬念/动作/情绪/对白 | A | 现有四张方法卡；只在从剧本模式，按拍摄计划转换时不加载 |
| 当前镜动作设计 | C1 | 待建字段合同；武指方法可按任务调用，但不把完整“打斗 Prompt”直接列为 Skill |
| 分镜微表情时序 | C1 | 现有独立 JSON 方法；按角色与可见性调用，首帧只读起态 |
| 分镜静态摄影设计 | C2 | 新合同；景别/机位/构图候选，不包括运动 |
| 分镜运镜设计 | C3 | 从 `seedance-camera` 提炼模型无关方法；只写动态摄影字段，旧 ID 保留旧行为 |
| 分镜节奏与转场 | C3 | 待建；时长、动作、切点和跨镜关系须明确，不能用完整文本扩写冒充 |
| 分镜视觉覆盖建议 | B/C2 | 待建；只提出有来源的本镜风格/光照覆盖，不改项目或场景基线 |
| 分镜连续性审阅 | D | 待建；只报告显式关联镜头的冲突与建议，不重写镜头全文 |
| H3 / Seedance 提示词适配 | E | 各自目标模型；模式、媒体和声音硬合同独立于可选 Skill |

首帧静态构图、特效与主体遮挡、动作起止、镜内节奏及转场的**可保存字段合同**仍有缺口；此表是候选目录，不表示已运行或已有生成效果。目录名称只承诺其实际输出范围：来源仓库名称留在详情/许可，模型无关方法名称不含模型名。旧 ID 的安装状态、保存选择和复选框迁移须单独兼容处理。

## Not yet proven / What would verify it

- 现有文本 Skill 加载只证明指令被拼入优化请求，不证明它输出了可采纳的设计字段。逐条准入需用同一镜头输入检查输出 schema、字段所有权、来源、冲突和未采纳不生效。
- 外部 Skill 的经验规则是否改善 H3/Seedance 成片，尚无受控对照。先核对同一已确认分镜版本在两模型的完整预览与提交语义，再固定素材/参数做视觉比较。
- 仅凭外部 README 或示例不能推断许可适用到每张样片或当前最新版本；需要引入具体文本/媒体时逐文件复核来源和授权。

验收去重需用同一镜头同时启用相关方法：每个字段至多一个候选差异和一个采纳动作，冲突有来源；未采纳时保存值、模型预览和提交均不变。切换 H3/Seedance 不重跑 C1–D，且两个编译器不得引入新剧情或镜头决定。

## Sources

- 本地事实：`config/agent_skills/catalog.json`、`director-tasks.json`、`micro-expression-timing.md`；`src/apps/comic_gen/models.py`；[阶段与产出物审计](2026-10-22-storyboard-stage-artifact-skill-audit-v1.md)；[两阶段命名清单](2026-10-23-storyboard-skill-two-stage-inventory-v1.md)。
- GitHub 已读记录：[外部 Film/Drama Skills 复核](2026-10-01-external-film-skills-review-v1.md)、[Creative Skills 来源](../design/agent-creative-skills-v1.md)、[武指词典评估](../research/2026-10-19-martial-arts-director-dictionary-review.md)、[结构化场景/分镜对照](../research/2026-10-17-scene-shot-structured-reference-comparison.md)、[工作台结构对照](../research/2026-10-18-github-structured-film-workbench-comparison.md)、[Pavo 对照](2026-10-22-storyboard-shot-skill-loading-v1.md)。
