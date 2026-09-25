# iframe 内容版本与 RAG 架构审计 v1

## 范围与结论

本审计只检查当前本地代码中的内容持久化、revision/hash、Director 产物和文本检索路径，不代表线上部署状态。当前功能代码基线为 `7f2c892b`，之后 HEAD 的提交只改架构文档；线上 `7a85c231` 的运行实现不在本地分支祖先链中。

**结论**：当前 iFrame 以结构化 Pydantic 模型为业务数据形状，再把项目/剧集序列化为 JSON 文件保存；异步分析任务状态另存 SQLite。它有少数用途明确的 revision/hash 和缓存失效标记，但没有统一的不可变内容版本、artifact lineage 或按依赖关系传播 stale 的通用机制。没有发现 Director 使用 embedding/向量相似度检索剧本的实现。

## Observed

### 持久化形态

- `Script` 内嵌 `original_text`、角色、场景、道具、分镜帧、任务及视觉配置等结构化字段；`Series` 也有独立的结构化字段。
- `pipeline.py` 从 `output/projects.json` 加载项目并整份写回；剧集和个人资产目录分别写到 JSON 文件。这是结构化 JSON 文档持久化，不是 RAG 向量库，也不是规范化关系数据库。
- `ExtractionJobs` 使用 `output/extraction-jobs.sqlite3` 存 job owner、project、fingerprint、状态、结果和错误。它是异步 job 状态/结果存储，不是内容 artifact 版本库；非运行结果在约 24 小时后清理。

### 版本标记与内容覆盖

| 内容 | 当前机制 | 代码事实/边界 |
|---|---|---|
| 剧本文本 | `updated_at` | 文本更新 API 原位改写 `original_text` 并保存，不递增内容 revision；该接口明确不触发实体重解析 |
| Director Profile | `revision`、`content_hash`、`confirmed_at` | Apply 根据当前 profile 计算编号/hash 并覆盖 `ArtDirection.director_profile`；模型中只保存当前 profile，不保存可查询的历史 revision 列表 |
| 角色/场景/道具/分镜 | Director revision/hash 快照及 `director_review_required` | 生成资产/分镜时记录使用的 Profile revision/hash；Profile 改变时将项目内角色、场景、道具和 frames 标为需复核，属于粗粒度标记，不是依赖图 stale 传播 |
| 分镜内容 | `id`、`updated_at`、生成状态等 | Storyboard apply 创建新 frame ID 并替换当前 `script.frames`；未发现通用的 frame content revision 或历史 artifact store |
| “上集摘要”/“下集 hook” | 文本长度 + MD5 短 hash | 用于判断缓存输入文本是否变化；这是局部缓存失效标记，不是 Script revision 或内容历史 |
| Director 分析/返修 | job fingerprint、job ID、状态和结果 | Job fingerprint 用于相同输入任务去重/复用；job 结果不等同于已批准、带父版本的 Director artifact |

### Director 当前输入与交互

- `analyze_director_profile()` 将原始剧本全文、已提取实体和视觉风格放入一次 LLM 请求；未发现此路径先检索片段或查询向量索引。
- Director Profile 面板允许查看/编辑 JSON 草稿、输入自然语言返修指令和显式 Apply。Apply 后服务端写入当前 profile；仅前端草稿编辑本身不是持久化 draft artifact。
- 另有 `DirectorWorkbench`（3D 导演台），面向三维角色/舞台/相机编辑，其本地草稿和 revision 属于独立浏览器工作区状态，不是 Director Profile 或剧本内容版本。

### RAG / 检索命中

- 源码中出现 `RAG-style map/reduce` 注释，但命中的实现是：长文本超过阈值后切成固定字符块，逐块生成短摘要，再把摘要拼接交给后续分集模型。没有 embedding 生成、向量存储或相似度召回步骤。这是分块摘要/Map-Reduce，不是通常所说的 Retrieval-Augmented Generation。
- 跨剧集资产名称匹配当前使用精确匹配和子串匹配；源码里的 embedding 语义相似度只是 future 注释，未实现。
- 对当前仓库执行源码和依赖搜索，没有发现 Chroma、FAISS、Qdrant、Milvus、pgvector、LanceDB 或 embedding SDK 的活动集成。此结论限于当前仓库，不推断外部线上服务或其他分支。

## Direct implication

1. 用户记忆的方向基本正确：现有主数据是结构化存储；Director 分析主要通过 prompt 输入剧本和结构化实体，不靠 RAG 搜回相关段落。
2. 不能把 `revision` 字段的存在等同于内容历史。Director Profile 有当前版本号和内容 hash，但上游剧本、分镜 frame 和其他产物没有与之对等的统一 revision/archive 机制。
3. 当前 Director revision/hash 主要用于标记下游“用过哪个 profile”及要求复核；它尚未表达“此 Director artifact 基于哪个 Script revision、经谁批准、被哪些具体下游产物引用”。
4. 长文本分块摘要有助于限制单次输入规模，但它与来源可追溯性、跨段事实核验和 Director 全局阐释版本是不同问题。
5. 对 Director 设计的首要架构工作应是明确结构化事实、阐释和拍摄计划的产物边界与版本/审批 lineage；RAG 不应先于这层权威结构，但 Assets/Storyboard 的局部证据需求说明检索能力应纳入分层架构，而不是被排除在外。

## Not yet proven

- 本地 JSON 文件形态不能证明线上生产数据库/挂载卷的具体部署配置，也不能证明生产环境没有额外备份、审计或外部索引。
- 现有分块摘要是否在特定长度、模型和提示词下丢失跨段因果或来源定位，需要运行时样本与原文对照验证。
- 文本被一次性放进 Director prompt，不足以证明每种模型请求都接收到完整剧本；还需核验具体模型上下文限制、adapter 截断策略和运行日志。
- 发现 Source refs/哈希字段，不自动证明它们在所有改写入口、并发场景和线上数据中保持一致。

## Architecture recommendation for Director optimization

采用分层内容与检索架构。先优化结构化权威层，再按实际召回缺口增加派生索引：

```text
L0  Canonical artifacts
    ScriptSource / ScriptFactLedger / DirectorInterpretation / DirectorShootingPlan
      ↓ exact revision + source refs
L1  Structured evidence projections
    scene index / character timeline / relationship state / prop state / beat index
      ↓ filtered by scene, character, phase, source range, artifact revision
L2  Retrieval adapters (可选、可重建)
    lexical/full-text search → semantic/vector search when measured necessary
      ↓ evidence snippets with source refs
L3  Stage context builders
    Assets / Storyboard / continuity QA / user question answers
```

- Script 正文修改创建新的 source revision；实体/事实解析结果绑定该 revision。
- 用户编辑先保存为可恢复 draft；批准时创建不可变 artifact revision。保存与批准/生效是不同动作。
- DirectorInterpretation 引用事实账本 revision；DirectorShootingPlan 引用批准的 DirectorInterpretation revision；Assets 与 Storyboard 固定引用确切上游版本。
- 用 artifact parent refs 或显式依赖边计算受影响的下游对象；只标记依赖发生变化的产物 stale，不将全项目布尔值作为唯一失效机制。
- L1 是第一阶段重点：把当前 `canon_state`、timeline、relationships、scene summaries、角色/场景/道具和 frame 引用规范化为可查询投影。它服务于局部上下文，不改变 L0 权威内容。
- Assets 生成至少可按角色、时期变体、关系状态、场景和导演约束查询证据；Storyboard 生成至少可按 shot/beat、scene、character、时间阶段、对白和连续性状态查询证据。
- L2 先实现确定性的 source range/metadata 过滤和全文检索；只有长剧本中出现结构化过滤无法覆盖的自然语言问题、上下文成本或召回缺口时，才增加 embedding/vector adapter。
- 任何 L2 命中必须返回 `source_revision_id`、`source_range`、`fact_ids`、相关 scene/character/beat 和索引版本；检索结果是证据上下文，不是新的事实或批准内容。
- 索引只能从 L0/L1 重建，不能成为唯一写入源。上游 revision 改变时，旧索引标记 stale，新索引异步重建；生成任务 pin 使用的 source/artifact revision 与 index revision。

### 第一阶段结构化检索契约

先提供稳定的领域查询，而不是让每个 prompt 自己拼全文：

```text
get_scene_evidence(flow_id, scene_id, source_revision_id)
get_character_timeline(flow_id, character_id, source_revision_id, phase=None)
get_relationship_state(flow_id, character_ids, source_revision_id, at_phase=None)
get_prop_state(flow_id, prop_id, source_revision_id, scene_id=None)
get_shot_context(flow_id, shot_plan_id, source_revision_ids)
find_source_ranges(flow_id, source_revision_id, query, filters={scene, character, phase, beat})
```

每个查询返回带来源和状态的结构化记录，供 Director 局部返修、Assets 角色/场景定义、Storyboard 完整镜头描述和连续性 QA 共用。这样先解决“相关内容在哪里、属于哪个版本、能否追溯”，再决定是否需要语义向量召回。

### 首个可实施切片

1. 选择包含线上 storyboard 修复的目标分支并确认权威持久化后，给 ScriptSource 增加不可变 revision 与稳定 source ranges；现有文本更新接口在兼容期维护旧读模型。
2. 建立 `ScriptFactLedger` 的最小结构化事实：`fact_id`、`kind`、`subject_ids`、`phase`、`source_revision_id`、`source_ranges`、`value`、`evidence_status`、`conflict_group_id`。先覆盖角色身份/时期、关系状态、场景、事件和道具状态。
3. 从确认的事实账本构建 L1 投影；查询必须显式传入 source revision，返回事实、剧本片段、来源与冲突状态。若索引版本与输入版本不匹配，返回明确过期错误，不静默查询当前版本。
4. 在 Director 审阅中先展示每条解释所用的事实与原文；在 Assets/Storyboard 生成路径引入同一个 context builder，分别按角色/场景和 shot/beat 取证据。
5. 用第一集选定的角色跨时期、关系变化和重复动作样本验证覆盖率与引用正确性；全局导演阐释仍由完整事实账本归纳，不能只由局部召回拼接。

验收以行为为准：同一查询在固定 revision 下结果稳定；剧本修改后旧查询可复现旧证据，新查询只读新证据；角色设计与分镜草稿能显示准确来源；冲突/未知项不被默认当作事实；局部返修不需要发送整集原文。

## What would verify it

- 对部署配置只读核对实际 `data_file`、`series_data_file`、job SQLite 路径、卷挂载/备份和额外数据服务；本审计未访问生产环境。
- 选取一集原文和生成 job，比较 source ranges、分块摘要、Director prompt 实际 payload 与模型调用/截断日志。
- 对照一次 Director Profile 修改前后的 projects JSON，验证旧 profile 是否另有历史副本，以及资产/frame 标记范围。
- 对照一次 Script 文本修改与 reparse，确认实体、summary cache、Director Profile 与 Storyboard 的实际失效边界。
