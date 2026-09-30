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

## 术语边界

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
