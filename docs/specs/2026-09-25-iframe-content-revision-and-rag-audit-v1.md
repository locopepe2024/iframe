# iframe 内容版本与 RAG 架构审计 v1

## 范围与结论

本审计只检查本地代码中的内容持久化、revision/hash、Director 产物和文本检索路径，不代表线上部署状态。当前分支为 `feature/iframe-3d-director-v1`，HEAD 为 `7d0f5046`；工作区另有未提交的 source revision、Director archive、ScriptFactLedger 审阅和产物 lineage 变更。线上 `7a85c231` 的运行实现不在本地分支祖先链中。

**结论**：当前 iFrame 以结构化 Pydantic 模型为业务数据形状，再把项目/剧集序列化为 JSON 文件保存；异步分析任务状态另存 SQLite。近期工作区改动补入了原文版本、导演档案、事实账本审阅与下游 lineage，但它们仍是在现有 Script 文档上的分层机制，不是统一 artifact store，也没有完整依赖图和通用 stale 传播。没有发现 Director 使用 embedding/向量相似度检索剧本的实现。

## Observed

### 持久化形态

- `Script` 内嵌 `original_text`、角色、场景、道具、分镜帧、任务及视觉配置等结构化字段；`Series` 也有独立的结构化字段。
- `pipeline.py` 从 `output/projects.json` 加载项目并整份写回；剧集和个人资产目录分别写到 JSON 文件。这是结构化 JSON 文档持久化，不是 RAG 向量库，也不是规范化关系数据库。
- `ExtractionJobs` 使用 `output/extraction-jobs.sqlite3` 存 job owner、project、fingerprint、状态、结果和错误。它是异步 job 状态/结果存储，不是内容 artifact 版本库；非运行结果在约 24 小时后清理。

### 版本标记与内容覆盖

| 内容 | 当前机制 | 代码事实/边界 |
|---|---|---|
| 剧本文本 | 工作区新增 `source_revision`、`source_revisions` | 文本改变会归档正文、SHA-256 和创建时间；`original_text` 仍是当前读模型。原文历史嵌在 Script JSON，不是独立 source store |
| Director Profile | 工作区新增 `revision`、`content_hash`、`confirmed_at` 与历史 snapshots | Apply 更新当前 Profile 并追加不可变确认快照；仍是 ArtDirection 内嵌模型，不是独立 Director artifact store |
| ScriptFactLedger | 工作区新增 draft、确认 revision、来源范围及 evidence status | 草稿保存与确认生效分离；确认项要求可校验原文范围。历史与当前事实均嵌在 Script JSON |
| 角色/场景/道具/分镜 | 既有 Director revision/hash 标记；本轮工作区新增 `generation_lineage` | 新产物记录 source、Director、ledger revision 与实际注入的 fact IDs。Storyboard preview pin lineage 并在 Apply/Refine 检查上游 revision；旧产物为空或 legacy_unpinned，不推断历史版本。该机制仍不包含实体定义、模型、风格与外部参考的完整输入快照 |
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
2. 不能把 `revision` 字段的存在等同于完整内容历史。原文、Director Profile 和账本现有各自的快照，但仍嵌在 Script JSON，尚无统一 artifact store。
3. 新增 source/Director/ledger revision 与产物 lineage 已能表达部分上游引用；它仍未表达完整生成输入、批准人身份和通用依赖边，不能等同完整 artifact lineage 系统。
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

### ScriptSource revision 切片（2026-09-25）

本切片在现有 `Script` JSON 文档内保存不可变原文快照，不引入独立数据库。`original_text` 仍是当前读模型；`source_revision` 指向当前版本，`source_revisions` 保存正文、SHA-256 和创建时间。旧项目首次写入时先保存旧正文为 revision 1，再保存变化后的正文；重复保存相同文本不产生版本。新项目创建时保存 revision 1。重新提取实体须保留原文和 Director 历史，并在正文变化时推进 source revision。提供版本列表和指定版本正文读取接口，供后续事实来源范围校验。

边界：这个切片只记录原文版本，不把现有 `canon_state` 自动认定为经证据核准的事实账本；文本变化仅标记 Director/下游待复核，不自动改写已批准导演决定。后续 `ScriptFactLedger` 必须引用明确的 source revision 和字符范围，并在审核后才作为下游事实输入。验收：同文保存幂等；不同文本可读取旧版；reparse 后版本及 Director 历史保留；旧项目可无损迁移。

### Director canon 查询适配器（2026-09-25）

已批准的 `DirectorProfile.canon_state` 可按类别、主体及当前 ScriptSource revision 查询，返回原始条目、显式状态、来源绑定情况和内容 hash。source revision 不匹配时拒绝查询；未绑定来源的条目明确计数，不因为位于已确认 Profile 内就升级为剧本事实。此 canon 查询接口仍不是 `ScriptFactLedger`。工作区中新加的 Assets/Storyboard context 使用的是经用户确认的 ScriptFactLedger，不把 canon 查询结果隐式提升为事实。

### ScriptFactLedger 审阅与下游 context（2026-09-25）

已在 `Script` 文档内加入当前事实草稿、当前确认账本和不可变确认 revision。事实字段为 `fact_id`、`kind`、`subject_ids`、`phase`、`source_revision`、`source_revision_id`、`source_ranges`、`value`、`evidence_status`、`conflict_group_id`。source range 使用从 0 开始的 Unicode code point 和左闭右开区间。确认时服务端校验 revision、唯一 ID、range 边界；状态为 confirmed 的事实必须带非空来源范围。查询会返回精确原文片段，且允许按旧的 ledger/source revision 回看。

导演工作台提供候选导入、JSON 编辑、草稿保存和单独确认操作。Director canon 导入会被转换为 uncertain 候选且清空精确范围；只有用户补足来源并确认后才形成有效 ledger revision。草稿保存使用 expected draft revision，确认使用 expected ledger revision，避免并发覆盖。剧本改动使旧账本保持可审计，但下游 context 标记其 stale 并排除事实内容。

Assets context 按 asset ID 过滤；Storyboard context 对应输入文本在原文中的唯一范围，长文本分块时按 chunk source range 过滤。没有唯一文本匹配时不猜范围，改用全局有界账本投影。下游携带 revision 与状态，提示词明确 uncertain/conflicted 不得写成已证实剧情。旧项目没有 ledger 时维持兼容，不强制阻断既有生成。

当前 JSON 编辑器是可审阅的第一版，不是可视化 source-range 选择器，也没有自动从剧本抽取并校对事实。自动提取、冲突组决策、便于用户点击原文标注的编辑器，以及按实体类别筛选事实仍是后续工作。该实现验证的是版本与证据边界，不证明模型会完全遵循事实状态。

验收以行为为准：同一查询在固定 revision 下结果稳定；剧本修改后旧查询可复现旧证据，新查询只读新证据；角色设计与分镜草稿能显示准确来源；冲突/未知项不被默认当作事实；局部返修不需要发送整集原文。

### Assets / Storyboard 产物 lineage（2026-09-25，实施切片）

**改动前的问题边界（代码事实）**：生成提示词能读到确认账本和导演执行摘要，但新资产/分镜只持久化 Director Profile revision/hash，无法从产物判断它使用的剧本与事实账本版本。Storyboard 草稿 job fingerprint 也没有 pin source/ledger revision，Apply 可以发生在输入版本已变化之后。

**设计决定**：为新生成的 Character/Scene/Prop 与 StoryboardFrame 增加一个可选、结构一致的 `generation_lineage`，包含 `source_revision` / `source_revision_id`、Director Profile revision/hash、Fact Ledger revision/source ID/status、生成上下文投影中的 `fact_ids`、可精确确认时的原文范围，以及 `pinned` 或 `legacy_unpinned` 状态。旧资产和旧帧字段为空，读兼容不回填推断值。Series 资产没有 Script parent 时 source lineage 为空。StoryboardApply 会把本次审核批次范围的 lineage 复制到该批所有帧；它目前不是逐帧 prompt transcript，也不证明每个 chunk 实际拿到的每条事实 ID。

Storyboard 预览 job 返回 `{ frames, lineage }`；revision lineage 进入 fingerprint。显式 Apply/Refine 将同一 lineage 带回服务端，服务端比较当前上游 revision 并在不一致时返回 409，不将旧草稿标记成新版本产物。Apply 将服务端重建并验证的 lineage 写进全部正式帧，避免信任浏览器提交的 fact IDs 和 source ranges。旧客户端不传 lineage 时保持兼容，但产物明确标为 `legacy_unpinned`。直接生成并立即 Apply 的旧接口在一次 pipeline 调用内捕获 lineage 并写入帧。

资产 lineage 在实际拼装提示词时捕获，成功生成后与该次输入一同写回目标资产；异步排队不提前虚构使用版本。该切片记录所依赖的 source/Director/ledger 版本，不声称锁定了角色说明编辑、风格配置、模型目录或外部参考素材等尚无独立 revision 的全部输入。

**边界**：不引入全局 artifact store、通用依赖图、自动 stale 级联或 RAG；本次也不拆 DirectorInterpretation/DirectorShootingPlan。只确保该切片新增的源/导演/账本 lineage 在产物生成与 Apply 边界不被静默错标。

**成功标准**：资产记录提示词使用的 Director/ledger revision 与事实投影 IDs；预览返回固定批次 lineage 并参与 job 去重；source、Director 或 ledger 变更后旧分镜草稿不能作为 current pinned 产物 Apply/Refine；成功 Apply 后正式帧保留批次 lineage；缺少 lineage 的历史记录仍可读取且不被伪造版本；相关后端、前端 API、组件测试、typecheck 和静态检查通过。

**受影响路径**：`src/apps/comic_gen/models.py`、`pipeline.py`、`api.py`、`frontend/src/lib/storyboardAnalysis.ts`、`frontend/src/lib/api.ts`、`frontend/src/components/modules/StoryboardR2V.tsx`、相关后端/前端测试及本审计文档。

## What would verify it

- 对部署配置只读核对实际 `data_file`、`series_data_file`、job SQLite 路径、卷挂载/备份和额外数据服务；本审计未访问生产环境。
- 选取一集原文和生成 job，比较 source ranges、分块摘要、Director prompt 实际 payload 与模型调用/截断日志。
- 对照一次 Director Profile 修改前后的 projects JSON，验证旧 profile 是否另有历史副本，以及资产/frame 标记范围。
- 对照一次 Script 文本修改与 reparse，确认实体、summary cache、Director Profile 与 Storyboard 的实际失效边界。
