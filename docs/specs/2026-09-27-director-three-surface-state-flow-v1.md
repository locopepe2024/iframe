# Director 三种工作面与重新生成状态流 v1

## 目的

Director 需要把三种不同任务明确分开：

1. **故事与导演总览**：补齐背景、人物、空间、时代和导演约束，形成分析输入。
2. **剧情时间线、人物关系与剧情线**：对同一份 `story_map` 做细化、分析和结构化修改，形成可确认的导演故事理解。
3. **思维导图**：快速阅读、检查结构和定位问题。它不产生第二份数据，也不替代编辑器。

三者都属于 Director interpretation 阶段；它们与 shooting plan 的 Scene → Beat → Shot 生成和确认保持边界。

## 证据与术语

- **Code fact**：当前前端把总览输入和 story map editor 放在同一组件树中；`profile` 是可编辑 draft，`story_map` 是其中的结构化子对象。
- **Code fact**：Director profile 的保存和确认已经是两个 API 动作；确认版本保存在 revision 历史中。
- **Code fact**：重新分析和 refine 通过异步 job 产生结果，不能直接把确认版本改写成新版本。
- **Algorithm implication**：思维导图只要从 `story_map` 读取，就可以与编辑视图保持同源；如果单独维护图节点状态，就会产生漂移。
- **Hypothesis**：用户当前难以理解的主要原因是三个场景没有显式的输入/结果/草稿状态标识，同时脑图把不同层级压缩成同级卡片。

## 一、三种工作面的职责

### A. 故事与导演总览（Brief / Context）

**回答的问题**：导演基于什么背景和约束来理解故事？

可编辑内容包括：

- 故事类型、时代、地点、社会语境；
- 故事核心、情绪弧线、节奏、视觉语言；
- 表演、对白、声音方向；
- 连续性约束、禁用项、未解决问题；
- 导演风格与导演意图（叙事/摄影/表演约束）。

此处的修改是 **analysis input draft**。它不会直接修改时间线、人物关系、剧情线或 shooting plan。

页面必须显示：

- `输入草稿` 状态；
- 当前对应的剧本 source revision；
- 当前事实账本 revision；
- 最近一次分析使用的输入快照；
- “保存输入草稿”和“基于输入重新分析”两个不同动作。

### B. 结构化分析与编辑（Story Map Editor）

**回答的问题**：故事按什么阶段、事件、人物关系和剧情线展开？

规范对象是同一份 `story_map`：

```text
story_map
├── phases[]
│   └── events[]
├── people[]
├── relationship_arcs[]
│   └── states[] (phase_id + trigger_event_ids)
└── story_threads[]
    └── milestones[] (event_id)
```

编辑器负责：

- 新增、删除、排序阶段和事件；
- 修改人物关系及其阶段状态；
- 将剧情线 milestone 绑定到已有事件；
- 绑定事实账本证据和 evidence status；
- 保存为 Director profile draft；
- 在确认前阻止不完整或 stale 的结构进入有效版本。

编辑器的修改只进入 **draft**。保存 draft 不等于确认；确认 Director interpretation 也不等于生成 shooting plan。

### C. 思维导图（Review / Navigation）

**回答的问题**：结构之间的父子关系、顺序和依赖是否清楚？

思维导图是 `story_map` 的只读结构化投影，允许：

- 展开/折叠分支；
- 沿父子关系查看 phase → event、person → relationship state、thread → milestone、scene → event/shot reference；
- 点击节点后在同一页面打开对应编辑对象；
- 显示证据状态、stale 标记和未完成项；
- 从节点进入编辑器继续修改。

思维导图不允许：

- 维护独立于 `story_map` 的节点副本；
- 直接确认 Director revision；
- 直接生成或修改 shooting plan；
- 用布局顺序代替故事顺序、因果关系或实体引用。

## 二、三种工作面的关系

```text
剧本 source revision + Fact Ledger revision + 导演风格
                         │
                         ▼
              故事与导演总览输入草稿
                         │ 保存
                         ▼
                 重新分析 job（新结果）
                         │ 完成
                         ▼
              Director interpretation draft
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
       Story Map Editor       思维导图 Review
       细化、修改、证据绑定       阅读、定位、跳转编辑
              │                     │
              └──────────┬──────────┘
                         ▼
              保存 Director draft
                         │
                         ▼
              确认 Director revision
                         │ 独立动作
                         ▼
             作为下游分析的明确输入
                         │ 独立动作
                         ▼
              生成/编辑 shooting plan
```

关键规则：

- 总览是输入层；story map 是分析结构层；思维导图是 review 投影层。
- 三者读写同一个 Director draft，但只有编辑器能改变 draft；脑图通过编辑入口改变 draft。
- “保存草稿”“确认 Director interpretation”“生成 shooting plan”是三个动作。
- shooting plan 的生成结果不能反向覆盖 story map；如果需要反向修改，必须通过事件/场景引用的明确编辑动作完成。

## 三、重新生成 / 重新分析逻辑

### 触发条件

用户在总览或编辑器中选择“重新分析”时，系统固定以下输入快照：

```text
source_revision
fact_ledger_revision
director_style_revision (if present)
current_confirmed_director_revision (optional)
analysis_instructions
visible_draft_snapshot
```

### 运行期间

- 不修改当前 confirmed Director revision；
- 不清空当前 draft；
- 页面显示 `分析中`，禁止对同一输入快照并发启动第二个 job；
- 失败保留旧 draft、旧 confirmed revision 和失败原因；
- 取消只终止 job，不产生新 revision。

### 成功后

模型结果必须先规范化为新的 draft candidate：

```text
analysis result
    → schema validation
    → source/fact lineage validation
    → merge policy
    → new Director draft candidate
```

默认 merge policy：

- 未被用户明确修改的分析字段可以由新分析结果更新；
- 用户已修改但尚未确认的字段必须进入冲突提示，不能静默覆盖；
- 已确认 revision 永远不被覆盖；
- 旧 draft 和新 candidate 都要可追溯，至少记录输入快照、job id、时间和来源。

### 用户决策

成功后展示三种结果：

1. **接受新分析**：用 candidate 替换当前 draft，仍需用户保存/确认。
2. **保留我的修改**：保留冲突字段，接受其余 candidate 字段。
3. **放弃新分析**：丢弃 candidate，恢复原 draft；confirmed revision 不变。

重新分析完成不等于确认。用户仍需先检查思维导图和编辑视图，再执行独立的 Director confirm。

## 四、变更传播规则

| 变更位置 | 立即影响 | 不应立即影响 | 生效条件 |
|---|---|---|---|
| 总览输入草稿 | 下一次分析输入 | 当前 story map、已确认 revision、shot plan | 保存并重新分析 |
| Story Map Editor | 当前 Director draft、思维导图投影 | 已确认 revision、已有 shot plan | 保存 draft；确认后下游可读 |
| 思维导图节点跳转 | 对应编辑器焦点 | 数据本身 | 在编辑器修改并保存 |
| Director interpretation confirm | confirmed Director revision、下游 lineage | 不自动创建 storyboard frame 或 motion task | 单独确认成功 |
| shooting plan 生成 | 新的 plan draft | Story Map draft/confirmed profile | 使用明确的 confirmed Director revision |

## 五、UI 必须显示的状态

页面顶部或工作面标题旁必须同时显示：

- 当前工作面：`总览输入` / `结构化编辑` / `思维导图 review`；
- `Draft` / `Confirmed` / `Stale` / `Analysis running`；
- source revision、fact ledger revision；
- 最近一次重新分析的 job 状态；
- 未保存修改提示；
- “保存”“重新分析”“确认”三个动作的区别。

脑图节点至少显示：

- 对象类型和标题；
- 父节点路径；
- 顺序或引用关系；
- evidence status；
- stale/conflict 状态；
- 点击后进入对应编辑对象，而不是打开另一个抽屉层。

## 六、后续实现切片

1. **状态与导航切片**：在 Director 页面显式区分三种工作面，保留同一 draft source。
2. **脑图投影切片**：将 phase → event、person → relationship、thread → milestone、scene → reference 做成真实父子树和边。
3. **重新分析切片**：补充输入快照、candidate、冲突和接受/放弃动作。
4. **确认边界切片**：增加 Director interpretation confirm 与 shooting plan generate 的 lineage 断言。
5. **验收切片**：验证刷新恢复、旧 profile migration、保存冲突、重新分析失败和确认后下游消费。

## 验收标准

- 用户能在首屏判断当前是在补输入、编辑分析，还是 review 脑图。
- 思维导图中的节点有真实父子关系，不以四个并列卡片代替层级。
- 修改只改变 draft；重新分析产生 candidate；确认才产生新 Director revision。
- 重新分析失败或冲突时，旧 draft 和 confirmed revision 可继续恢复。
- shooting plan 只能读取明确的 confirmed Director revision，不能读取未保存或未确认 draft。

