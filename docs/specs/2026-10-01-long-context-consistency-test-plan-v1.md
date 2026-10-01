# Director 长上下文一致性测试与优化计划 v1

## 目标

验证并优化以下三条链路：

1. 数万字原始剧本分集后，各集之间的人物、关系、地点、年代和伏笔状态保持一致；
2. 单集一万字以上剧本经过 source chunk → Director 理解后，事件、人物关系和场景覆盖不漂移；
3. 已确认 Director 理解进入拍摄计划后，scene → beat → shot 分片生成保持顺序、角色、场景和连续性。

本计划把“成片时长”“原始剧本文字量”“镜头素材时长”分开测量。素材最终可能远长于成片，不能用素材小时数直接决定 Director 输入 chunk。

## Evidence levels

- **Code fact**：当前每次 Director/拍摄计划请求都是独立 LLM 请求，依靠持久化原文、source refs、结构化 profile 和 handoff 恢复上下文；没有跨请求 provider session 依赖。
- **Algorithm implication**：chunk 摘要是召回和压缩记忆，不是原文替代物；chunk 边界不等于剧情场景边界。
- **Hypothesis**：在相同模型和 prompt 下，单块摘要比完整原文更容易丢失中段事件、角色别名和关系变化。
- **Needs validation**：哪一个字符数、token 数或成片时长是最佳边界，不能从经验直接确定。

## 一、测试变量

### 1. 原文规模

使用可复现的剧本 fixture，控制以下输入长度：

| 级别 | 单集原文字数 | 用途 |
|---|---:|---|
| S | 2,000–4,000 | direct 路径基线 |
| M | 5,000–12,000 | 当前最容易出现单块压缩的范围 |
| L | 12,000–30,000 | 多 chunk 与跨场景 handoff |
| XL | 30,000–80,000 | 长集、网大或长剧实验 |
| Series | 80,000+ | 先分集，再做跨集一致性 |

字符数只是可观测输入指标。每次运行必须同时记录 provider 的 input/output tokens、缓存 token、响应时间和失败阶段。

### 2. 成片时长

以下是测试分组，不是强制剧本字数规则：

| 成片形态 | 重点测试 |
|---|---|
| 1 分钟短片 | 单事件、少角色、快速验证 shot handoff |
| 10 分钟短剧 | 多事件、局部关系弧、场景连续性 |
| 45 分钟单集 | 跨 chunk、伏笔和人物状态累积 |
| 2 小时电影 | 分段 Director 理解、宏观故事线与全片回溯 |

同一时长可以有不同文字量。测试报告必须以原文字数和事件/场景数量为主索引，时长作为辅助维度。

### 3. 结构变量

每个 fixture 至少包含：

- 角色首次出现、别名和时期变体；
- 至少一次关系状态变化；
- 至少一个跨 chunk 伏笔 setup/payoff；
- 至少一个地点或年代变化；
- 至少一个角色认知状态变化（不知道 → 怀疑 → 确认）；
- 至少一个连续性约束（道具、服装、伤势、天气或时间）；
- 有意放置在 chunk 中段的关键事件，用于检测摘要丢失；
- 用户确认的导演补充，例如城市视觉锚点，验证其不会被误写成剧本事实。

## 二、测试层级

### A. Series → Episode 分集一致性

输入整部 80k、160k、320k 字符的连续剧本，先生成分集，再对每集运行实体提炼和 Director 理解。

每集输出必须带：

- `series_context_revision`；
- `episode_source_revision`；
- 角色 canonical ID 和别名映射；
- 跨集 relationship/epistemic state handoff；
- 未完结 story thread 和下一集预期入口；
- 原文 source range。

检查项目：

1. 同一人物在不同集是否被拆成多个 canonical person；
2. 时间、地点、年代是否发生无来源跳变；
3. 已确认关系状态是否被下一集摘要覆盖或倒退；
4. setup/payoff 是否能通过 event ID 跨集关联；
5. 上一集 open thread 是否在下一集被错误标记为 close；
6. 分集边界是否切断一个事件，切断时是否保留 source range 和 handoff。

### B. Episode → Director 理解一致性

对 5k、10k、15k、30k 字符单集分别运行三组：

1. `direct`：完整原文送入 synthesis；
2. `map_reduce`：现有 chunk 摘要路径；
3. `auto`：生产默认路径。

每组使用相同模型、实体、风格 preset 和输出约束。保存：

- raw response；
- source audit；
- mapped notes；
- digest；
- normalized profile；
- unresolved refs 和 warnings。

比较指标：

| 指标 | 计算方式 |
|---|---|
| 事件覆盖率 | gold event 被 story_map event 或 scene_summary 回指的比例 |
| 人物覆盖率 | gold character 在 event/relationship 中正确绑定的比例 |
| 关系覆盖率 | gold relationship transition 被正确表达的比例 |
| 场景覆盖率 | gold scene 被 scene_summary 或 timeline 覆盖的比例 |
| 伏笔保持率 | setup/payoff/thread milestone 仍保持顺序的比例 |
| 无来源新增率 | 无 source ref 且不能归入 interpretation 的内容比例 |
| unresolved 率 | 无法绑定的引用数 / 总引用数 |
| 结构失败率 | JSON、schema、admission 失败任务比例 |

当前建议的验收目标（初始假设，需用 fixture 校准）：

- 事件、人物、关系和场景覆盖率 ≥ 95%；
- 伏笔顺序错误为 0；
- 无来源新增率 ≤ 5%；
- unresolved 引用必须可审阅，不得静默丢弃；
- 上游已返回时，本地不得因可修复字段使整份结果不可见。

### C. Director → Shooting Plan 分片一致性

拍摄计划不得重新读取未经确认的原始全文作为唯一上下文，而应接收：

```text
adopted Director profile
+ scene summaries
+ story map / thread milestones
+ continuity constraints
+ relevant source refs
+ previous batch handoff
```

测试 1 分钟、10 分钟、45 分钟和 2 小时成片对应的事件/场景规模，但按拍摄计划 token 预算分 batch，而不是按成片分钟数硬切。

每个 batch 必须验证：

- scene、beat、shot 顺序连续；
- 前一 batch 的 `state_out` 与下一 batch 的 `state_in` 一致；
- 人物、场景、道具引用来自当前 canonical asset set；
- 空的可补充创作字段不会阻止保存；
- batch 重试不重复生成已经完成的段；
- shot 计划不反向修改剧本或 Director 理解。

## 三、推荐的初始分片策略

这是测试起始值，不是最终产品限制：

### Director source map

- 优先按自然场景、段落和事件切分；
- 单 chunk 目标 4k–6k 字符；
- 硬上限 6.5k 字符；
- 每个 chunk 保留 source range、参与人物、地点、时间和状态变化；
- 关键事件不应只出现在 head/tail anchor；
- 单集 5k 左右必须纳入 direct vs digest A/B，不直接假定摘要足够。

### Director synthesis

- 读取 bounded digest + 必要的原文窗口，而不是只读取摘要；
- 对中段关键事件提供可检索 source range；
- digest 超限时优先减少冗余格式，不删除事件、人物和关系状态；
- 任何压缩都记录 `digest_sha256` 和压缩策略版本。

### Shooting plan

- 以 scene/beat 边界切 batch；
- 每 batch 只提交当前场景集合、导演执行摘要和 continuity handoff；
- batch 目标由 provider token 预算决定，建议先从 8k–16k input tokens 做压测；
- 超时或上游限制时缩小 batch，不重新提交整集。

## 四、优化顺序

### Phase 1：可观测性

- 完成 raw response、source audit、digest 和 normalized profile 持久化；
- 在 job UI 显示 source mode、字符数、chunk 数、token、失败阶段；
- 建立 fixture 与 golden events。

### Phase 2：单集 A/B

- 对 5k/10k/15k/30k 字符运行 direct、map_reduce、auto；
- 统计覆盖率、漂移类型和上游耗时；
- 判断问题属于摘要遗漏、实体别名、模型新增还是本地绑定失败。

### Phase 3：跨集 handoff

- 增加 Series Context revision；
- 测试跨集人物、地点、年代、关系和伏笔；
- 对分集边界事件建立显式 continuation handoff。

### Phase 4：拍摄计划压测

- 用已确认 Director revision 生成多 batch shooting plan；
- 测试 1/10/45/120 分钟成片规模；
- 验证超时、重试、断点恢复和状态连续性。

## 五、结论边界

- 不能把 1 分钟、10 分钟或 45 分钟直接换算成固定字符阈值；
- 不能把原始素材拍摄时长当作 Director 上下文长度；
- 不能在没有 A/B 数据时宣布 4,000 字符错误或正确；
- 不能用“模型返回成功”替代事件覆盖和连续性验证；
- 不能因为一致性检查发现问题就自动修改剧本原文。

## 验证命令

```bash
pytest -q tests/test_director_profile.py tests/test_director_shooting_plan.py tests/test_extraction_jobs.py
python3 -m compileall -q src/apps/comic_gen
git diff --check
```
