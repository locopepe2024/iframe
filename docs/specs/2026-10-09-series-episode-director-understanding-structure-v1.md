# Series / Episode Director 理解场景与分析结构 v1

日期：2026-10-09
状态：设计规范；未实现本规范的长文本归并与运行验收

## 1. 目标与证据边界

先定义全剧和单集各自回答什么问题，再决定长文本怎样切片、归并和送入模型。Director 输出是待审阅的解释；剧本原文及用户明确要求分别保留，不因模型归纳而改变。

**Observed（代码事实）**：Series 与 Episode 有独立的 Director 版本；当前全剧分析拼接投稿前言与各集正文，长来源采用 map/reduce；最终 digest 限 3000 字符，来源区间元数据可单独超过此限。本集分析读取本集原文和提取实体，并可读取 Series 理解作为只读背景。

**Direct implication**：全剧与单集需要不同的来源身份、分析粒度和输出验收；单纯扩大模型上下文或缩短每段摘要都不能解决来源混淆及全剧覆盖问题。

**Not yet proven**：下面的分层归并能提高真实模型的事件覆盖率或连续性。须以带人工标注的长剧本对照测试验证。

## 2. 分析场景

| 场景 | 输入 | 产物 | 必须避免 |
| --- | --- | --- | --- |
| 全剧资料尚无分集正文 | 投稿梗概、人物小传、创作要求 | `series_provisional`：人物、世界、主线及未决问题候选 | 把梗概当成某一集已经发生的事件 |
| 全剧资料加完整分集 | 版本化全剧资料与各集剧本 | `series_complete`：跨集顺序、关系/认知状态变化、伏笔、世界规则、连续性约束 | 抹掉集边界；把某集的场景写成全剧共通场景 |
| 新增、重排或修改一集 | 当前 Series 已采用版本与受影响分集版本 | `series_reanalysis_required` finding；重新生成受影响的全剧草稿 | 静默改写既有全剧版本或其他集版本 |
| 单集首次理解 | 当前集原文/实体、已采用 Series 投影（如有） | 本集事件地图、叙事场景候选、入出场状态和本集导演解释 | 将系列梗概中的未来事件当成本集事实 |
| 单集局部修订 | 当前集原文、当前草稿、明确修订指令及来源窗口 | 有界 patch 与影响范围 | 用局部 patch 替换未经触及的已确认事实 |
| 无 Series 的独立项目 | 单部剧本 | 按 Episode/单片粒度理解；不构造虚假的全剧 handoff | 强制创建 Series 对象 |

`series_provisional` 可供创作规划，但不能标成全剧完整覆盖。任何全剧或本集分析均先生成 draft，用户采用后才成为下游制作上下文。

## 3. 来源目录与层级

每个来源单位至少保留 `source_kind`（submission_synopsis、character_bio、episode_script、user_constraint）、`series_id`、可选 `episode_id`、`source_revision/hash`、原文内 `[char_start, char_end)`、全局稳定 `source_ref`。`episode_script` 的区间以该集原文为坐标；不得用字符串拼接后的全剧偏移冒充集内位置。用户要求与剧本事实是不同来源类别。

```text
原文来源目录（不可变版本）
  -> 有来源的分片/叙事场景候选
  -> Episode 局部事实与状态变化
  -> 跨集 Series 归并及冲突检查
  -> Series Director draft -> 用户采用
  -> Episode Director draft（本集原文 + 有界 Series 投影）-> 用户采用
  -> 拍摄计划 / 分镜
```

分片是传输和计算单位，不自动成为叙事场景。场景候选可以跨相邻分片；跨集同地点也不是同一场景。跨集故事线通过稳定事件/关系引用连接，而不是合并场景记录。

## 4. 全剧 Director 的分析结构

全剧层回答“整部作品如何变化，以及哪些规则跨集有效”，不生成逐镜拍摄方案。至少包含：

1. `world_and_premise`：时代、地理、文化、规则与明确未知项；每项标记来源类别。
2. `episode_index`：集 ID、原文版本、覆盖状态、集内时间范围、主要事件与开放结尾。缺集或未完成集显式标记。
3. `series_people`：规范人物身份、别名、时期变体、首次/最后可证实出场集；人物小传与剧情中实际行为分开。
4. `series_event_spine`：按剧情时间排序的跨集关键事件及因果关系；每项关联集 ID、局部 event ID 和来源范围。
5. `relationship_and_knowledge_arcs`：关系与人物认知状态的前值、触发事件、后值；不能只保留最终状态。
6. `story_threads`：主线/支线的 setup、progress、turn、reveal、payoff/open/close，允许悬而未决。
7. `global_continuity`：跨集人物、道具、伤势、时间、地点、空间与禁用项；每条有生效范围，不把局部状态永久化。
8. `interpretations_and_intent`：导演对主题、节奏、情绪、视觉/表演/声音的解释，与剧本事实分栏；风格 preset 仅约束表现形式。
9. `conflicts_and_unknowns`：资料互相矛盾、缺失集、同名人物歧义、来源不足的结论；待用户决断，不自动补写。

Series 的 `scene_summaries` 只能是跨集索引或宏观叙事阶段摘要；逐场 `scene_ref` 属于 Episode。已有 `DirectorProfile` 可继续作为兼容投影，但完整 Series IR 不应通过填塞 Episode 场景字段来表达。

## 5. 单集 Director 的分析结构

单集层回答“这一集实际发生什么，如何承接和交给下一集”。至少包含：

1. `episode_scope`：episode ID、原文 revision/hash、采用的 Series Director revision/hash；独立项目的 Series 引用为空。
2. `scene_index`：本集叙事场景候选，含本集 source ranges、地点/时间、参与人物、入场/出场状态及未解决引用。
3. `episode_story_map`：有序 phase/event/beat 候选、因果、戏剧功能和证据状态；事件 ID 只在明确映射后进入跨集 spine。
4. `local_relationship_changes`：本集关系、目标与认知状态变化，注明触发事件及进入/离开状态。
5. `thread_handoff`：本集回收、推进和新增的伏笔；未解决项带到下一集，但不宣称下集已经发生。
6. `episode_continuity`：本集场景间及与上一集的时间、空间、人物、服装、道具、伤势和轴线约束。
7. `director_interpretation`：表演、节奏、镜头、声音及可选导演补充；新增内容标为解释或用户要求。
8. `review_findings`：与已采用 Series 上下文冲突、原文矛盾、身份歧义或证据不足的项目。

已采用 Series 内容仅作只读约束和索引，不复制成当前集 `timeline`/`story_map` 事实。单集明确出现但与 Series 草稿不同的事实，先保留本集证据并形成冲突 finding；不自动修改全剧或其他集。

## 6. 长文本处理与请求准入

- 分片前先登记来源身份与版本。map 阶段提取可回查的事件、人物、状态变化和未决项，不能只返回自由文本 summary；服务器拥有区间，模型不能自报来源 ID。
- 第一层在每集内按场景/事件顺序归并；第二层按集归并为 Series spine。每层都记录输入 refs、覆盖范围、遗漏/冲突、归并策略版本和输出 hash。
- 最终 Series 请求只接收有界的跨集投影及必要原文窗口；Episode 请求只接收本集相关窗口与有界 Series handoff。中段关键事实必须可按 source_ref 回查。
- 准入预算覆盖**完整请求**：系统预设、来源投影、实体、风格、当前草稿、用户指令和预留输出。记录字符估算与实际 provider token；超预算时按层重新归并或要求缩小范围，不静默删除事件、证据或集别。
- 摘要缓存与可恢复批次绑定来源版本/hash、source_ref、模型/能力、模板与归并策略版本；只有匹配全部 lineage 才能复用。失败重试只补缺失段。
- Director 结果必须通过结构、来源身份、引用完整性、覆盖和冲突检查；通过 JSON/schema 校验不等于语义正确。未确认的结果不得进入拍摄计划。

## 7. 版本与下游交接

Series 和 Episode 各自保存不可变已采用 revision。Episode 记录其采用时读取的 Series revision；后续 Series 更新只产生“需复核”提示，不悄悄重写本集历史。视觉风格动态继承遵循现有风格合同；已采用 Director 的故事事实不随风格变化。

下游读取：`已采用的本集 Director + 精确 Series revision 投影 + 当前制作所需 scene/event/source refs`。拍摄计划按本集叙事场景生成 scene → beat → shot；全剧 Director 不直接下发逐镜头任务。Markdown 导出是同一 revision 的可读投影，不成为第二套事实源。

## 8. 验收与实施顺序

1. 冻结来源目录、Series/Episode IR 与 lineage 合同；用“投稿梗概 + 两集正文 + 跨集伏笔”建立 golden fixture，明确哪些事实只属于某一集。
2. 先验证确定性边界：百万字符可完整分片并分层归并；没有裸 `source_ref` 数量导致的固定摘要上限失败；全请求预算及超限错误可定位。
3. 验证版本边界：改一集后旧 Series/Episode revision 保留，新草稿标记受影响范围；缓存不跨版本、模型或模板命中。
4. 做真实模型 A/B：短、中、长集与 80k/160k/320k 全剧，比较事件、人物、关系、场景、伏笔覆盖率、无来源新增率、跨集状态漂移、结构失败率、token 与耗时。阈值先按 `2026-10-01-long-context-consistency-test-plan-v1.md` 的候选值记录，再由样本校准。
5. 用户在 UI 审阅冲突、未知与来源窗口后采用 Series 和 Episode 草稿；刷新和后续拍摄计划仍引用同一已采用版本。

影响路径（后续实现）：`src/apps/comic_gen/{models,llm,pipeline,api,extraction_jobs}.py`、Director 前端审阅面、对应测试与版本化预设。此文档不授权自动改写剧本、批量重生成现有分镜，或把模型输出直接提升为已确认事实。

相关规范：`2026-09-30-series-episode-structured-context-v1.md`、`2026-09-30-director-long-source-continuity-review-v1.md`、`2026-10-01-long-context-consistency-test-plan-v1.md`、`2026-10-08-series-style-director-inheritance-v1.md`、`2026-10-08-project-and-series-context-unification-v1.md`。
