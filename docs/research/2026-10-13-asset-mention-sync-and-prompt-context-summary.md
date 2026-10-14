# `@` 索引同步与提示词上下文摘要

日期：2026-10-13
范围：nsfw iFrame 的角色/Cast 参考选择、资产缩图、图像资产生成及视频润色。本文记录当前代码行为；待改进项不视为已实现。

关键源码：`src/apps/comic_gen/pipeline.py`（索引、引用解析、资产生成）、`src/apps/comic_gen/api.py`（预览、润色接口）、`src/apps/comic_gen/prompt_assembly.py`（分镜提示词组装）；`frontend/src/components/modules/CharacterWorkbench.tsx`、`frontend/src/components/modules/cast/CastWorkbenchModal.tsx`、`frontend/src/components/modules/playground/ReferencePromptEditor.tsx`、`frontend/src/components/shared/AssetIndexPreview.tsx`（前端索引与展示）。

## Observed（代码事实）

### `@` 参考索引

- `GET /projects/{id}/asset-index` 由 `pipeline.get_asset_reference_index` 生成，按项目、系列、全局素材顺序合并；同一素材 ID 在较近作用域已出现时不重复列出。索引条目携带素材类型、ID、来源作用域、容器 ID 和图片变体 ID。只有当前索引里存在的变体才可成为有效结构化参考。
- 角色工作台在项目资产快照变化、打开参考选择器、首次输入 `@` 时重新请求索引；用请求序号丢弃过期响应。新索引到达后，清理已选列表中失效的变体。Cast 工作台在打开、项目资产变化、打开选择器或首次输入 `@` 时重新请求；提交前还会重新查询索引，拒绝已消失的参考。
- `ReferencePromptEditor` 在 `pruneUnlistedReferences` 模式下移除候选索引已不包含的结构化 `@` token。手写的 `@名称` 不会自动升级为素材引用；真正提交的是 `{asset_type, asset_id, variant_id}`。后端任务执行时再次按当前可见资产和变体解析 ID，缺失或越权引用会失败。
- 角色、Cast 和 Playground 素材选择器的缩图使用 `AssetIndexPreview`：经鉴权请求 `/asset-index/preview`，将响应转为临时 Blob URL，并在卸载时释放。索引的 `episode` 作用域在预览请求中映射为 `project`。主机先前只读抽查的 27 个图片变体预览均返回 200；这支持“该批缩图的前端路径有问题”，不证明所有历史素材都完整。

### 提示词上下文

- 角色视觉设计草稿的前端请求包含角色信息、用户视觉要求、已选参考、已确认设计和风格字段，但后端 `CharacterDesignRequest` 目前只声明 `model`、`character_name`、`profile`、`route`、`age_stage`、`style`、`confirmed_design`。LLM 的 user 消息使用 `body.model_dump(exclude={"model"})`，因此不能认为额外的用户要求和参考已进入该 LLM 请求。确认后的设计值经 `buildCharacterImagePrompt` 形成各视图的可编辑图片提示词；这一步没有把完整 Director JSON 附加到图像生成提示词。
- 项目资产生成的 `pipeline.generate_asset` 将用户/工作台提示词交给图像适配器，并把 Director 信息保存在 `generation_lineage`。代码显式将 `effective_positive_prompt` 设为空，避免将全局场景风格及 Director 上下文附加到独立角色、道具或场景图像。Cast 生成请求也发送空 `style_prompt` 和 `apply_style=false`。
- 系列资产走另一条 `generate_series_asset` 路径：`apply_style=true` 时可取系列 Art Direction 的完整正、负面风格提示词。因此“图像请求只带摘要”目前并非覆盖所有资产入口的统一契约。
- 视频/R2V 润色接口从当前 `frame_id` 的 `director_shot_context` 选场景定位/时段、匹配的地点时段光影基线及镜头视觉、表演、构图、运镜、光照、环境声等字段。字段先限长，再按优先级删减低优先级字段，保持 JSON 可解析且最多 1200 字符。前端另传草稿、参考图、目标模型、时长和项目/镜头 ID；润色后的中英文提示词须经过模型契约校验。
- 分镜细化时，`prompt_assembly.py` 从当前镜头的 `director_shot_context` 提取连续性、动作、镜头和光影条款，去重后写入帧的 `assembled_prompt`。代码检索只发现写入和模型字段定义，未找到生成提供商读取该字段的路径；因此不能认定这些条款已进入实际图片/视频请求。该组装逻辑未对条款设独立的总字符上限。

### 上下文消费边界核对

| 场景 | 已读取的上下文 | 实际消费方与尚未贯通的边界 |
| --- | --- | --- |
| 系列导演解读 | 系列前言和所属各集原文、各集提炼实体、系列风格 | 导演分析 LLM；系列解读不直接成为单集已经发生的剧情事实。 |
| 单集导演解读 | 本集原文和提炼实体；有系列时加入系列前言与已确认系列解读；有效美术风格 | 导演分析 LLM；确认后才是本集导演版本。 |
| 拍摄计划生成 | 剧本分块、有效资产、已确认导演执行投影、视觉风格和上一场简短 `continuity_out` | 计划 LLM；跨分块只有有界上一场信息，并无结构化的全剧集状态账本。 |
| 拍摄计划确认及资产同步 | 地点/时段 ID、两者组合的光影基线、人物/道具/场景绑定 | 确认版投影到 `EpisodeVisualContext`，现已保留基线列表；共享时段但不同地点的两条室外基线目前互不校验。 |
| 分镜抽取 | 本集片段、资产、计划视觉上下文、导演执行投影、视觉风格及前面最多三帧 | 抽取 LLM；命中计划 `shot_id` 后复制当前场景/镜头字段、连续性 ID、匹配基线与计划版本到帧。帧快照尚无结构化切镜状态。 |
| 分镜细化 | 当前粗帧、相邻帧文字简述、角色/场景资产、项目风格、导演执行投影和当前计划镜头 | 细化 LLM；相邻帧是描述，不是经过比较的 `state_out/state_in`。细化写 `assembled_prompt`，但不能据此证明渲染使用它。 |
| 分镜图片渲染 | 调用方传入的帧提示词、选定参考图；生成器还补入角色名称/描述，未传提示词时才从帧动作、场景和机位构造默认提示词 | 图片提供商；渲染路径没有读取 `assembled_prompt` 或重新投影地点/时段及邻镜状态。光影约束只有进入传入提示词时才可能生效。 |
| 视频/R2V 润色与视频任务 | 润色 LLM 读取当前 `frame_id` 的有界场景/镜头字段和匹配的地点/时段基线；任务创建读取调用方提示词、媒资引用和帧引用版本，并可能补对白提示 | 视频任务没有重新读取计划基线或比较相邻镜头状态；润色结果是否包含连续性约束取决于实际提示词与后续提交。 |

### 五类入口的上下文提交矩阵

| 入口 | 写入/读取的上下文 | 下游去向与边界 |
| --- | --- | --- |
| 剧集：Series Director | 投稿前言、各集原文、从各集提取的角色/场景/道具、系列风格。长文本可能先转为带来源锚点的有界摘要。 | 送 Director 分析 LLM；结果先是草稿，确认后成为系列级只读 handoff，不等于任何一集已发生的事件。见 `pipeline.preview_series_director_profile`、`llm.analyze_director_profile`。 |
| 剧集：Episode Director | 本集原文与本集实体；如属系列，再加入 `series.source_context` 和已确认 Series Director；加入有效 Art Direction 风格。 | 送 Director 分析 LLM；确认后写入本集 Director revision 和有界 `episode_understanding.episode_summary`。跨集 `incoming_handoff/outgoing_handoff` 没有真实分析时仍为空。见 `pipeline.director_analysis_context`、`confirm_director_profile`。 |
| 分镜：拍摄计划、抽取、细化、润色 | 拍摄计划用剧本分块、实体、已确认 Director 执行投影、视觉风格及上一场简短 handoff；抽取用剧本片段、有效资产、拍摄计划视觉上下文、Director 投影、风格及最多前三帧衔接；细化用粗分镜、相邻帧、资产和当前镜头拍摄计划；润色用当前 `frame_id` 的选定镜头字段。 | 这些内容送各自的分析/润色 LLM。拍摄计划以 revision 保存；抽取结果给帧写 `director_shot_context`；细化写 `assembled_prompt`。实际分镜图片渲染读取帧提示词并补角色/场景描述及参考图，代码未发现读取 `assembled_prompt`。见 `pipeline.preview_director_shooting_plan`、`preview_storyboard_analysis`、`refine_frame`、`api._get_director_prompt_context`、`storyboard.py`。 |
| 角色：设计与图片 | 设计请求当前真正接收角色名称、profile、路线、年龄阶段、style、已确认设计；前端额外传的参考和用户视觉要求未进入该后端请求模型。项目图片用工作台提示词与显式 `@` 变体；Director 执行上下文记入 lineage。 | 设计字段送 LLM；项目图片提示词/参考图送图像模型，不自动附加整份 Director。系列资产可另附系列 Art Direction。见 `agent_api.CharacterDesignRequest`、`pipeline.generate_asset`、`generate_series_asset`。 |
| 道具、场景：图片 | 当前未找到与角色设计草稿同类的专用道具/场景 LLM 请求。项目资产用用户提示词，空提示词退回名称/描述，加固定质量/构图短语；显式 `@` 参考图按 ID 解析。 | 项目资产的 Director/事实信息只记 lineage，不作为附加正文；系列资产在 `apply_style=true` 时可附完整系列风格。场景参考图还可能在分镜渲染中被使用，角色/场景描述也会补入分镜图片提示词。见 `pipeline.generate_asset`、`assets.generate_scene`、`assets.generate_prop`、`storyboard.py`。 |

## Direct implication（直接推论）

- 删除共享/全局资产后，角色或 Cast 工作台需要一次索引刷新才会更新已打开的候选；后端执行时的 ID 解析是最终有效性边界。刷新请求未完成前，旧候选可能短暂仍显示。
- 视频/R2V 润色中的“摘要”是按当前镜头筛选的字段投影，不是对整份 Director 解读做自动语义压缩；分镜细化仍会读取更宽的导演执行投影。相同 `frame_id` 的固定字段和排序有助于稳定润色输入，但缓存命中率还取决于实际请求内容与上游缓存规则，尚无测量数据。
- 项目资产、系列资产、视频润色、分镜已组装提示词的上下文策略不同；不能用其中一条路径的行为概括全部图片和视频请求。

### 剧集与切镜连续性

- 相关上下文应按阶段投影，而不是把完整 Director JSON 作为每个请求的后缀：角色定妆使用剧集视觉风格和角色身份/造型；场景参考图使用剧集风格、该地点及时段的环境状态；分镜与视频再加入当前镜头和相邻镜头的交接状态。这是目标契约，当前各入口尚未统一实现。
- 同一时段从长街切到另一条室外街道时，地点、遮挡和场景资产改变，但世界太阳方位、日光阶段与天气应沿用同一时段状态。树荫下的阴影与树荫外的夕阳直射可以同时成立；这是局部遮挡差异，不等于镜头独立换光。摄影机换向时画面中的左右光向也可改变，不能直接据此判定太阳方向冲突。
- 当前拍摄计划以地点/时段组合保存基线，没有独立的时段级室外光状态，也没有结构化的上一镜结束/本镜开始状态。分镜帧现能保留当前镜头的连续性 ID 和匹配基线，但跨地点同一时段、同街切镜及局部遮挡仍缺少可判定的状态交接。详细代码事实、目标模型、校验边界与测试样例见 [剧集与跨镜头连续性摘要](2026-10-13-episode-shot-continuity-state-and-validation-summary.md)。

## Not yet proven / Hypotheses

- 尚未实测每个入口送到图像/视频提供商的最终请求长度、上下文相关性或缓存命中率；“污染减少”“缓存提升”是待验证效果。
- 其他独立维护索引的界面（例如 ConsistencyVault、StoryboardR2V）是否存在同样的删除后短暂过期显示，需要分别核查。当前修复和回归测试覆盖角色、Cast 与素材选择器，不等于全站事件驱动同步。
- 尚未通过提供商请求与生成结果验证跨镜头状态继承、跨街室外光照一致性或树荫局部遮挡；计划基线和文档契约不能证明实际画面连续。

## 建议的下一步

1. 将资产创建、删除、变体变更统一发布为索引失效事件，界面收到后重取；在请求期间阻止旧 `@` 候选被选中，并保持请求序号防止乱序覆盖。
2. 给图像和视频生成建立按入口明确的上下文预算：投影相关的剧集视觉状态、场景地点/时段状态、当前镜头和必要的相邻镜头交接状态；LLM 分析可读取更宽上下文。系列资产的风格拼接应纳入预算；分镜 `assembled_prompt` 先确认实际消费者再决定是否调整。
3. 在测试中记录最终提供商 payload 的字符数、字段来源、已删除引用拒绝行为；再用实际请求日志比较提示词长度、质量与缓存命中率。

## 2026-10-13 增量实现

- 角色设计草稿请求现在接收并投影前端提交的 `user_visual_requirements`、`user_answers` 和 `current_draft`；后端限制字段数量和长度，模型仍只返回可编辑草稿，不自动确认。
- 分镜图片渲染在提供商调用前追加当前 `StoryboardFrame.director_shot_context` 的有界视觉投影（地点、时段、交接、当前镜头动作和光影），已存在于用户提示词的值不会重复添加；完整 Director 执行 JSON 不进入该提示词。
- 增加了角色设计上下文和分镜投影回归测试。素材、会话文本和确认记录的持久化字段未改变。
- 尚未接通场景资产专用设计技能；场景图仍需后续从已确认剧集地点/时段投影中选择最小字段，避免把整集上下文附加到通用场景资产请求。
- 2026-10-13 后续：剧集场景/道具工作台已增加独立的 AI 设计草稿入口。设计要求、当前草稿和已确认设计发送到 `/agent/asset-design/draft`；结果可编辑、保存或确认到资产的 `asset_design` 字段，并可应用到当前图片 Prompt。场景资产在仅绑定单一已确认拍摄计划场景时，生成请求额外投影地点、时段、天气、氛围和入/出场状态；共享场景资产不自动继承互相冲突的场景上下文。

## 验证记录

- 2026-10-13：相关前端 5 个测试文件、58 项测试通过；`npm run typecheck` 通过。nsfw 前端重建成功，主机 `127.0.0.1:31880/` 返回 HTTP 200。本地和主机源码在排除依赖、缓存及构建产物后 `rsync -rcni --delete` 无差异。
- 未做登录态浏览器逐屏目视验证，也未采集提供商最终 payload 或缓存统计。

## 2026-10-13 上游输入 Token 异常记录

### Observed（运行记录）

- nsfw 新增渠道 `#5`（GLM）和 `#6`（Kimi）后，网关日志显示请求计费路径为 `upstream`，不是 nsfw 本地拼接后的独立计费。
- GLM 请求输入约 `18,890` tokens；其中一次上游/网关记录显示缓存约 `18,880` tokens。
- Kimi 请求输入约 `14,977` tokens；多次记录显示缓存约 `14,848` tokens。
- 只发送单句用户消息、绕过 nsfw Agent 直接请求 `llm.globalstore.ai`，仍复现同量级输入 Token。
- Kimi 设置 `reasoning_effort: "none"` 后仍返回少量 reasoning 输出；这只能说明上游可能强制推理，不能解释大段输入 Token。

### Direct implication（直接推论）

存在一个稳定的大型上游前缀或隐藏上下文，位置至少在 `llm.globalstore.ai` 或其后端服务链路中。当前证据不足以区分网关配置、模型供应商注入或 usage 统计错误。

### Not yet proven / Hypotheses（未证实/假设）

- 尚未证明固定前缀具体来自渠道 system prompt、模型别名 persona、供应商隐藏提示词，还是统计口径错误。
- 该现象不能归因于 nsfw Agent 最近保留的剧集、素材或会话上下文；直连上游复现与此假设不符。

### What would verify it（明日向上游核查）

1. 渠道 `#5/#6` 的完整 system prompt、persona 和模型别名映射。
2. 上游是否向每个请求注入固定模型说明或安全策略文本。
3. Prompt cache 的固定前缀长度及 input/cache token 统计定义。
4. 关闭隐藏 persona/模板后的单句请求 Token 对比。
