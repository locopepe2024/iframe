# Series → Episode → Director 结构化上下文 v1

## 目标

为“分集 → 单集剧本分析 → Director 理解 → 拍摄计划”建立可恢复、可审计的结构化上下文边界。这里的上下文是服务端持久化的业务事实和已采用分析结果，不是假设模型会话一直存在。

## Evidence levels

- **Code fact**：当前每个 LLM 阶段都通过新的 `llm.chat()` 请求；代码没有持久化 provider conversation/thread ID。
- **Code fact**：剧本原文、source revision、实体、Director profile、story map、fact ledger、拍摄计划批次和 lineage 已被持久化或可重建。
- **Algorithm implication**：后续阶段通过重新注入结构化产物获得上下文，而不是读取上一轮模型聊天记录。
- **Not yet proven**：任一上游 provider 是否提供稳定、可跨进程恢复的 conversation session；当前不依赖该能力。

## 当前流程审计

```text
整部原文
  └─ 分集请求（独立 LLM 请求）
       └─ 每集原文 Script（持久化）
            ├─ 实体提炼（独立请求）
            ├─ Director 理解（独立请求）
            │    └─ Director profile / story_map / scene_summaries / canon_state
            └─ 拍摄计划（独立请求）
                 └─ scene → beat → shot + chunk handoff
```

当前 Director 到拍摄计划的上下文传递最完整；分集结果目前主要用于切分原文，尚未形成可供每集 Director 读取的系列级叙事上下文。

## Director 理解优先的记忆流水线

用户提供的长文本方案提出“滑动窗口摘要 + 记忆状态机 + 故事线追踪”。这与 iframe 的结构化上下文方向一致，但 iframe 在进入任何拍摄或分镜阶段前增加一个明确的人工审阅层：

```text
原始剧本
  ↓
逐场 / 分片摘要
  ↓
Series / Episode 记忆与故事线候选
  ↓
Director 理解（事实、结构、关系、时间线）
  ↓ 用户保存并采用
导演意图（视觉、表演、声音、节奏）
  ↓ 用户保存并采用
后续制作阶段
```

### 微观层：场次摘要

每个自然来源片段或叙事场景可以产生有界摘要，至少包含：

- 核心事件；
- 参与人物；
- 地点和时间锚点；
- 角色当场目标/状态变化；
- 新出现的信息、秘密或未决线索；
- `source_ref` 与 `[char_start, char_end)`。

摘要是压缩记忆，不是原文替代物。摘要遗漏的内容不能被解释为剧本没有该内容。

### 中观层：故事线与认知状态

当前 `story_map`、`relationship_arcs`、`story_threads` 和 `scene_summaries` 已经可以承载：

- 阶段与事件顺序；
- 人物关系状态及触发事件；
- 主线/支线的 setup、progress、turn、reveal、payoff、open、close；
- 场景入场/出场状态。

后续可增加“认知状态”作为关系或事件的有来源扩展，例如：

```text
人物 A 是否知道秘密 S
  - unknown
  - suspected
  - confirmed
  - disproved
```

该状态必须绑定触发事件、来源范围和 revision，不能只由模型在某次请求中口头判断。它属于 Director 理解候选或用户确认的结构化状态，不是自动写回剧本原文。

### 宏观层：压缩记忆检索

当用户询问“哪些伏笔尚未回收”“某角色在哪些阶段改变立场”时，第一检索层应优先使用：

1. scene summaries；
2. story thread milestones；
3. relationship / epistemic state 变更日志；
4. unresolved questions 和 canon state；
5. 必要时回到原文 source range 做证据核验。

压缩记忆用于召回和定位，不能取代原文证据。任何输出都应显示来源事件、集号和 source range。

## 分析维度的工程边界

### 情感弧光

Director 可以为角色和阶段记录定性情绪状态，也可以附带有限的数值标记用于排序或可视化。数值不是剧本事实，也不是自动质量分数。

高斯平滑或其他曲线平滑算法属于可选展示层算法，不能在没有评测的情况下作为 Director 理解的确定性算法。原始情绪观测、平滑参数和最终展示结果必须可区分、可回溯。

### 节拍与结构检测

系统可以检查催化剂、中点、低谷、转折等候选位置，但 10%–15%、50%、75% 等比例只是编剧理论启发式，不是所有剧本的硬规则。

建议输出：

- 候选节拍位置；
- 关联事件和来源范围；
- 结构解释；
- 置信度或不确定性；
- 用户接受、修改或忽略的入口。

不能因为缺少某个理论节拍而阻止用户采用 Director 理解。

### 一致性审查

一致性审查可以比较：

- 人物行为与已确认性格/禁用项；
- 人物知道什么与事件顺序；
- 地点、时代、天气和道具状态；
- 关系状态与触发事件；
- 伏笔 setup 与 payoff；
- 前后场景的 continuity_in / continuity_out。

审查结果应是带证据的 review finding 或候选 patch。所谓 Writer Agent / Critic Agent 可以作为内部执行角色，但不能形成没有来源、没有 revision 的隐式“集体记忆”，也不能自动修改 Director 理解。

## 与当前实现的差异

- **已实现**：长文 source chunk、scene summaries、story map、story threads、relationship arcs、canon state、unresolved questions、Director revision 和 continuity handoff。
- **已实现但仍需增强**：剧情线跨段追踪、跨集 Series Context、失败后记忆重建。
- **尚未实现为独立对象**：角色认知状态日志、伏笔回收索引、可解释的一致性 finding 历史。
- **不应直接引入**：强制三幕式 gate、固定百分比节拍 gate、未经评估的情绪曲线平滑、隐式多 Agent 长期 session。

因此，iframe 的关键产品差异是：

> 模型先生成 Director 理解候选，用户审阅并采用后，才成为后续流程的上下文。

这使“模型认为发生了什么”“导演希望如何理解”“原文明确写了什么”保持可区分。

## Markdown 交接文件与 Agent 上下文

Drama Skills 的 `分集剧本.md`、`视觉设定.md`、`分镜.md` 等文件，不只是导出格式，也承担了阶段之间的上下文约束。它们把“上一阶段已经决定什么、下一阶段可以读取什么、哪些内容必须保持不变”写成 Agent 能读取、用户能审阅的交接面。

iframe 可以借鉴这种做法，但需要把三类内容分开：

### 1. Agent 规则文件（静态约束）

类似仓库级 `AGENTS.md` 或 skill reference，规定：

- 当前阶段的职责和输入/输出边界；
- 哪些字段是原文事实、哪些是导演解释；
- 不得改写剧本原文；
- 必须保留 source refs、revision 和 unresolved 状态；
- 允许为空的创作字段不能被当作结构错误；
- 生成前必须经过用户采用或确认。

这类文件属于产品/Agent 版本，修改它会影响整个工作区或一类任务，不应被每集用户随意编辑。

### 2. 项目阶段 Markdown（动态上下文）

等价于：

```text
剧本.md / 分集剧本.md
视觉设定.md
分镜.md
提示词.md
```

它们属于项目 artifact，记录当前项目的创作决定和可读交接内容。iframe 不必把它们作为第二套权威存储，可以由结构化 revision 生成，并提供 Markdown 导入/导出视图：

| Markdown 交接物 | iframe 结构化来源 | 下游作用 |
|---|---|---|
| 分集剧本.md | Episode source revision + Episode Context | 当前集原文、事件顺序、人物出场和用户修订边界 |
| 视觉设定.md | adopted Director Intent + style config + continuity locks | 视觉风格、人物/场景/道具连续性和可选视觉锚点 |
| 分镜.md | Director Shooting Plan revision | scene → beat → shot、镜头顺序、起止状态和导演效果 |
| 图片/视频提示词.md | Storyboard / generation prompt artifact | 可执行提示词、参考图槽位、模型参数和生成前预览 |

Markdown 导出必须带上：artifact revision、source revision、Director revision、更新时间和生成契约版本。导入时先进入 draft，不能直接覆盖已采用 revision。

### 3. Agent 运行时上下文包（动态投影）

真正提交给模型的不是整个项目目录，而是按当前任务生成的 bounded context bundle：

```text
Agent Rules
  + Current Artifact Markdown projection
  + Structured IDs / source refs / lineage
  + Relevant Series Context projection
  + Previous chunk or scene handoff
```

这样可以同时拥有 Markdown 的可读交接和结构化数据的精确校验。模型请求结束后，结果必须先通过 schema、source refs 和 lineage 校验，再生成新的 Markdown 投影。

### 重要边界

- Markdown 是上下文交接面，但不是自动事实证明。
- Agent 规则是静态约束；项目 Markdown 是用户可修改的 artifact；运行时 context bundle 是按任务裁剪的投影，三者不能混存。
- UI 展示的 Markdown 与下游 prompt 使用的结构化 payload 必须来自同一个 revision，不能出现两套内容。
- 用户修改 `分集剧本.md` 或 `视觉设定.md` 后，系统应生成新 draft revision，并显示哪些下游产物需要重新采用；不能静默重跑全部剧本分析。

### 1. Series Context

全剧共享的、跨集稳定上下文：

- 系列级人物身份与时期变体索引；
- 跨集关系弧和阶段顺序；
- 跨集地点、时代和世界规则；
- 尚未解决的悬念与连续性约束；
- 分集边界和来源区间；
- `series_context_revision`、摘要、更新时间和采用状态。

Series Context 不直接替代某一集的原文事实。它必须保留来源集号和 source range；跨集推断标记为 `interpretation` 或 `uncertain`。

### 2. Episode Context

单集可执行上下文：

- episode source revision / source revision ID；
- 本集角色、场景、道具实体；
- 本集事件、时间线、剧情线和叙事场景候选；
- 本集待决问题及用户回答；
- 本集 fact ledger；
- `episode_context_revision` 和 adopted 状态。

### 3. Director Context

用户确认后才进入下游：

- Director 理解：原作事实、时间线、关系变化、故事结构；
- Director 意图：视觉、表演、声音、节奏和可选视觉锚点；
- story map、scene summaries、canon state；
- Director revision、content hash、source lineage；
- draft / adopted / superseded 状态。

未采用草稿、模型候选和用户尚未接受的修改不得进入拍摄计划 prompt。

### 4. Shooting Context

拍摄计划自身的上下文：

- 已确认 Director revision/hash；
- 当前 episode source revision；
- source chunk refs；
- scene → beat → shot 结构；
- 跨分片 continuity handoff；
- unresolved entity refs；
- generation attempt 和批次恢复状态。

拍摄计划是独立可编辑产物，不反向修改剧本原文或 Director 理解。

## 版本和 lineage 合同

每个下游生成请求必须携带或记录：

```json
{
  "series_context_revision": 3,
  "episode_id": "episode-1",
  "source_revision": 1,
  "source_revision_id": "source-r1:...",
  "episode_context_revision": 2,
  "director_profile_revision": 4,
  "director_profile_hash": "...",
  "fact_ledger_revision": 1,
  "effective_style_hash": "...",
  "generation_contract_version": "director-shooting-plan-v1"
}
```

版本字段的作用是：

- 恢复同一个 generation attempt；
- 判断缓存批次是否仍可复用；
- 生成 diff 和审计记录；
- 防止旧的 Director 理解被误用于新剧本。

版本字段不是为了阻止用户编辑。用户可以基于任何历史版本创建新的 draft；只有生成时应明确显示它基于哪组版本。

## 上下文组装规则

### 分集阶段

分集模型可以读取整部原文或长文摘要，并必须返回：

- episode number/title；
- 原文 start/end marker；
- 精确或可校验的 source range；
- 每集摘要；
- 跨集人物、地点、悬念候选。

服务端校验 marker/range 后保存 Episode Context 初稿。分集摘要不是剧本事实账本，不能直接覆盖 episode 原文。

### 单集实体和 Director 分析

每集 Director 请求的输入顺序为：

1. 当前集原文或有界 source digest；
2. Series Context 的相关投影；
3. 当前集实体和 fact ledger；
4. 用户采用的导演风格和约束；
5. 当前 Director draft（修订时）。

Series Context 只注入与当前集人物、阶段、地点或悬念相关的 bounded projection，不能把整个系列所有集原文重复发送。

### 拍摄计划

拍摄计划读取：

1. 当前集原文分片；
2. 已确认 Director execution payload；
3. 当前集实体；
4. 相关 Series Context 投影；
5. 上一分片的 continuity handoff。

拍摄计划不读取未采用 Director 草稿，也不依赖模型聊天历史。

## 连续性账本

跨集和跨分片分别维护两种状态：

### Series continuity ledger

- 人物长期身份、时期和关系状态；
- 跨集未解决悬念；
- 已确认的时代、地点、世界规则；
- 来源 episode、event ID 和 evidence status。

### Shooting handoff

- 上一场 `continuity_out`；
- 当前时空、人物/道具状态；
- 最近 beat 和 source refs；
- unresolved entity refs；
- 当前 Director revision/hash。

两者都只是生成上下文。它们不能凭空创造原文事件；模型新增内容必须标记为 `interpretation`、`optional_director_addition` 或 `unresolved`。

## 恢复和缓存

- Series/Episode/Director/Shooting Context 采用服务端持久化，不依赖浏览器 localStorage。
- chunk cache 必须绑定 source ref、完整 lineage 和 contract version。
- provider 返回超时或浏览器断开时，已完成批次保留；重试只处理缺失批次。
- 服务重启后可以恢复结构化上下文和批次，但不能假设能恢复 provider 的聊天 session。
- 如果上下文版本变化，旧批次显示为 stale，不能静默复用。

## 与外部项目的比较

### 四层剧本分析架构的映射

用户提供的参考架构可以抽象为：

```text
原始剧本
  → 结构化解析
  → 分层记忆与图谱
  → 多维分析与评估
  → 报告 / 可视化
```

它与 iframe 的对应关系如下：

| 参考层 | iframe 当前对应物 | 当前状态 | 边界 |
|---|---|---|---|
| Format Parser | `parse_novel()`、Script source revisions、角色/场景/道具提炼 | 已有 | 解析结果是候选结构，不能替代原文；原文保持只读和可回溯 |
| Layered Memory & Graph | Script Fact Ledger、Series Context、Episode Context、Director `story_map`、关系弧、scene summaries | 部分已有 | 必须区分原文事实、导演解释、用户决定和未决问题 |
| Scene-by-Scene Pipeline | source chunk、叙事场景、拍摄场次、beat、shot、continuity handoff | 已有基础 | chunk 边界不是场景边界；拍摄场次不是原作场景；shot 是下游规划产物 |
| Multi-Agent Analysis | Director 理解、导演意图、连续性审阅、拍摄计划生成 | 部分已有 | 当前是多个独立阶段请求，不是持久化的多 Agent 会话 |
| Emotional / Beat / Consistency checks | emotional arc、pacing、story map、continuity constraints、unresolved questions | 已有基础 | 评估结果应是可解释建议，默认不能成为未经用户同意的硬 gate |
| Report / Dashboard | Director 图谱、时间线、人物关系、剧情线、拍摄计划图 | 已有基础 | 可视化是结构化 artifact 的视图，不创建第二份事实或版本 |

### 必须补充的 iframe 约束

参考架构强调“图谱”和“分析报告”，但没有说明事实来源、版本采用和用户修改边界。iframe 需要额外保留：

1. **来源链**：每个事实、事件、关系状态和场景候选都可回指 `source_revision_id` 与 source range。
2. **分层状态**：`source_fact`、`director_interpretation`、`user_decision`、`hypothesis`、`uncertain` 不能混为一个节点类型。
3. **版本采用**：模型返回先进入 draft；保存和采用是不同动作；下游只读取 adopted revision。
4. **局部修订**：用户修改 Director 理解时，优先生成 patch 或局部 revision，不自动重新改写剧本原文。
5. **可恢复任务**：报告生成、长文 map/reduce 和拍摄计划分片都要保存 attempt、batch、lineage 和更新时间。
6. **用户决定权**：一致性检查可以提示人物、时间、地点、道具或场景冲突，但不能为了追求报告完整度而替用户新增剧情。

### 推荐的 iframe 落地流水线

```text
Script Source Revision
  ↓
Format / Entity Parse
  ↓
Script Fact Ledger + Episode Context
  ↓
Series Context + Story Map / Relationship Graph
  ↓
Director Interpretation
  ↓ adopted revision
Director Intent + Continuity Review
  ↓ adopted revision
Shooting Plan: narrative scene → production scene → beat → shot
  ↓
Storyboard / Assets / Motion adapters
```

其中“分析报告”不应是独立权威对象，而应是以下结构化产物的只读投影：

- 事实来源审阅：来自 Script Fact Ledger；
- 故事结构视图：来自 Story Map；
- 人物关系视图：来自 relationship arcs；
- 场景/连续性视图：来自 scene summaries、shooting plan handoff；
- 质量检查视图：来自带证据的 review findings。

如果未来需要导出 PDF 或仪表盘，应记录导出所使用的 artifact revision 和 index revision；导出的报告不能反向成为新的事实来源。

### `ops120/ai-novel-screenplay-analyzer`

公开 README 可确认：本地 SQLite、多项目、章节脉络、人物关系全景、关系演化、异名候选合并、长任务暂停/继续/分片恢复、G6 图展示。

可借鉴：

- 把章节/分集、人物关系和恢复任务作为一等产品资源；
- 用可筛选的结构化索引支持局部阅读；
- 用持久化任务状态支持刷新后恢复。

不能直接等同：

- README 不证明其内部使用 conversation session；
- 不证明关系图就是事实来源；
- 不证明其分片合并算法和 iframe 相同；
- iframe 使用 API key 和服务端工作区，不采用浏览器本地 SQLite 作为身份或主存储。

### 用户提供的 GraphRAG / 多 Agent 方案摘录

可借鉴：知识图谱架构师负责实体、事件、关系和时空索引；视觉导演负责把已确认叙事转成镜头语言；审核专家提供可解释检查。

边界：GraphRAG、向量检索、个性化记忆和多 Agent 协同不是 iframe 当前已验证事实。第一阶段采用确定性的 source range、metadata、revision 和结构化过滤；只有出现可测召回缺口后才增加向量检索。

### iframe 当前方案

iframe 已有更明确的版本和用户决策边界：

- 剧本原文不被 Director 改写；
- Director draft 需要用户保存/采用；
- 拍摄计划独立版本化；
- unresolved reference 不应拒绝整份计划；
- chunk handoff 不等于语义场景边界；
- 结构化上下文是可审计投影，不是模型隐式记忆。

## 不在本切片实现

- 不接入 provider conversation/thread API；
- 不新增 GraphRAG、向量数据库或隐式长期记忆；
- 不把系列摘要自动升级为剧本事实；
- 不让 Series Context 覆盖用户已经确认的 Episode/Director revision；
- 不改变当前用户确认和拍摄计划独立版本边界。

## 后续实施顺序

1. 为 Series 增加 bounded `series_context` 和 revision 元数据。
2. 从现有分集结果、系列资产和已确认 Director profile 构建候选 Series Context。
3. 增加用户可查看、编辑、采用的 Series Context 草稿界面/API。
4. 将相关 Series Context 投影注入每集 Director 分析，并记录输入 lineage。
5. 将采用的 Series Context 投影注入拍摄计划和分片 handoff。
6. 增加跨集一致性测试：人物时期、关系变化、地点/年代和悬念状态。

## 成功标准

- 重启或换浏览器后，可以根据持久化 revision 恢复同一结构化上下文；不依赖 provider session。
- 每集 Director 请求可以明确列出使用的 Series/Episode/Director 版本。
- 拍摄计划失败重试不会重复调用已完成分片，也不会混入旧上下文批次。
- 用户可以看到当前上下文来源、revision、摘要和采用状态。
- 任何跨集推断都有来源 episode/event 或明确的 `interpretation` 状态。

## 验证命令

```bash
pytest -q tests/test_director_profile.py tests/test_director_shooting_plan.py tests/test_extraction_jobs.py
python3 -m compileall -q src/apps/comic_gen
git diff --check
```
