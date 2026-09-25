# Director 可视化审阅工作台 v1

## 目标

把 Director 阶段改成一个可审阅、可修订、可保存草稿并显式确认生效的工作台。顶层采用三个页签：

1. **故事理解**：导演如何理解故事、人物、冲突、情绪、时间线、线索和连续性。
2. **拍摄计划**：按场景、戏剧节拍和正式镜头组织拍摄计划，明确镜头数、时长、剪辑理由。
3. **风格选择**：选择并保存项目/系列视觉风格。

主要编辑体验应是结构化表单和可视化，而不是原始 JSON。JSON 保留为可折叠的高级查看、导入和导出通道。

## 代码事实

- 当前 `DirectorProfilePanel` 已有结构化故事字段、旧格式阶段列表、旧关系图和可折叠高级 JSON；AI 结果先进入编辑草稿，草稿通过独立接口持久化，Apply 才写入确认版本。
- `DirectorProfile.timeline`、`relationships`、`key_events`、`sample_plan` 在前端和后端均为开放对象数组，缺少稳定的领域字段约束。
- 当前常见 relationship 形状包含 `pair / initial / change / final`，但没有必需的 `phase_id` 或带来源的状态转换，因此不足以推断精确的人物关系时间图。
- 后端现已加入可选的严格 `DirectorProfile.story_map`；phases/events、按阶段的 relationship states、story threads 和角色变体引用都经过 Pydantic 约束。pipeline 在保存/确认时绑定当前剧本文本 revision、稳定来源 ID 和有效角色变体，并验证关系/事件引用及可选 Fact Ledger ID。旧草稿的空 `story_map` 不进入旧内容 hash。
- 前端当前仍编辑旧 timeline/relationships；story map 规范视图和 Fact Ledger 证据选择尚未接入，因此新增后端契约目前不改变旧项目的呈现方式。
- Story map 草稿允许暂缺阶段名、事件描述或显式事实引用，便于用户分步编辑；确认时要求至少一个有名阶段、至少一个有描述的事件，并要求标为 `explicit` 的事件/关系状态引用已确认事实。
- `sample_plan` 当前用于少量场次示例，含 `range / purpose / focus / asset_need` 等描述；它不等于 scene/beat/shot 拍摄计划，也没有镜头时长及 shot ID。
- `ScriptFactLedgerPanel` 已提供独立的草稿保存、确认、历史版本与原文证据接口，但其事实编辑入口目前也是 JSON textarea。
- 风格选择已具备独立的目录、预览、项目保存、系列继承/覆盖行为；它目前与 Director Profile 共存于 `art_direction`。
- 现有 Director Profile 历史只对确认版本归档。原始 Profile 分析和返修草稿离开当前组件后没有服务端持久化保证。

## 直接推论

1. 仅把 textarea 包进 tabs 不会提供故事审阅能力，也不会产生正式拍摄计划。
2. 把当前 `relationships` 直接绘成按时间精确排列的关系图会掩盖缺少阶段引用的事实；现有 `initial/change/final` 只能展示为摘要阶段，不能伪造对应剧情时间点。
3. 关系图和时间轴必须是同一结构化文档的视图；可编辑表单/列表是等价的无障碍操作路径，不把拖放作为唯一输入方式。
4. DirectorInterpretation、DirectorShootingPlan、风格选择属于不同的用户判断，不能通过同一个“确认 Profile”动作一起生效。

## 不在本规格中认定的事项

- 现有镜头数量是否正确，以及第一集 158 条记录应合并为多少正式镜头；需要先对原始分镜和剧本做镜头规划。
- 图谱可视化本身会提升用户的导演判断质量；需要用用户任务验证。
- 自动识别的关系变化一定能获得原文证据。没有 source range 的项必须显示为导演解释、假设或待确认。

## 数据边界

### ScriptFactLedger：证据与剧本事实

保持为 Script 阶段的独立权威来源。事实条目引用 `source_revision`、`source_ranges`、主体 ID、阶段和证据状态。Director 页面可以引用、筛选和展示这些事实，但不能把导演解释写回事实账本。

### DirectorInterpretation：导演阐释

目标为单独、可版本化的领域产物，引用明确的 ScriptSource 与 ScriptFactLedger revision。至少覆盖：

- 核心主题、故事问题、主线/支线和希望观众带走的感受；
- 人物目标、人物弧光、关系变化、冲突结构；
- 按顺序排列的故事阶段、事件、线索铺设/揭示/回收；
- 情绪曲线、节奏、叙事重点、延迟揭示及理由；
- 视觉、表演、对白、声音和剪辑原则；
- 连续性约束、禁止项、假设和待用户决定项。

时间线使用稳定 `phase_id`、排序、事件 ID、source refs 和 evidence status。人物关系图使用角色节点，以及按 `phase_id` 记录的关系状态转换。缺少精确原文定位的项保留 `interpretation / uncertain` 标记。

```json
{
  "source_revision": 3,
  "source_revision_id": "source-r3:<content-hash>",
  "fact_ledger_revision": 2,
  "people": [{
    "person_id": "shen-xia",
    "display_name": "沈夏",
    "variant_character_ids": ["shen-xia-college", "shen-xia-graduate"]
  }],
  "phases": [{
    "phase_id": "phase-02",
    "order": 2,
    "label": "考研结果后",
    "events": [{
      "event_id": "event-07",
      "order": 1,
      "title": "升学与离校",
      "description": "沈夏考上研究生，周涵前往北京",
      "character_ids": ["shen-xia-college"],
      "dramatic_function": "校园共同生活被切断",
      "source_fact_ids": ["fact-17"],
      "evidence_status": "explicit"
    }]
  }],
  "relationship_arcs": [{
    "relationship_id": "shen-xia__zhou-han",
    "person_ids": ["shen-xia", "zhou-han"],
    "states": [{
      "phase_id": "phase-02",
      "state": "进入异地关系",
      "trigger_event_ids": ["event-07"],
      "source_fact_ids": [],
      "evidence_status": "interpretation"
    }]
  }],
  "story_threads": []
}
```

这是目标结构的概念示例。当前后端字段名为 `source_fact_ids`，且已接受严格的 `story_map`；引用通过 `fact_ledger_revision` 固定到已确认账本。旧 Profile 的 `timeline` 和 `relationships` 仍按旧版兼容数据展示；不能自动生成精确的 phase/event ID 或 source range。

### DirectorShootingPlan：拍摄计划

必须是独立于阐释的结构化产物，绑定已确认的 DirectorInterpretation revision 与原文/事实账本 revision。至少包含：

- `scene_plan[]`：场景边界、时间、地点、内外景、人物、戏剧目的、情绪、预计时长和连续性进出状态；
- `beat_plan[]`：场景内按序排列的动作/戏剧节拍、持续时间、来源范围和是否应与下一个节拍保持同镜；
- `shot_plan[]`：稳定 `shot_id`、对应 scene/beat IDs、镜头时长、景别、机位、构图、运镜、切镜理由、连续性锚点。

一个 shot 可容纳多个 beat。Beat 数不得直接换算成 shot 数。场景总时长与镜头时长应可校验。Storyboard 只能消费已确认 shot plan，不能将 beat 当成 shot。

### 风格选择

沿用现有风格目录、项目/系列继承和覆盖逻辑。风格选择独立于故事理解和拍摄计划保存；后续如需完整 lineage，再为其单独记录 revision/hash，不在本次 UI 外观变化中伪造现有历史。

## 用户交互与版本语义

- AI 生成、修订或用户手动编辑都会产生 **草稿**。
- **保存草稿** 只保证可恢复，不使 Assets/Storyboard 自动采用它。
- **确认生效** 创建不可变的确认 revision；下游产物固定引用确切 revision。
- DirectorInterpretation 确认后，用户可以生成/修订 DirectorShootingPlan 草稿。拍摄计划确认后才进入 Assets/Storyboard 的正式规划链。
- ScriptSource 或 ScriptFactLedger revision 改变时，依赖它的草稿/确认产物保留用于审计并标记 stale；不得静默重写用户已确认的导演决定。
- 保存草稿需要 expected draft revision，确认需要 expected confirmed revision，以阻止并发编辑互相覆盖。
- 图、表和表单必须读写同一规范化数据。时间轴可通过卡片顺序编辑；关系图节点/边可选中后在详情面板编辑。键盘可操作列表需与图同步，拖放只作可选增强。
- 高级 JSON 模式必须校验字段、保留未知兼容字段，并与结构化视图双向同步；格式错误时禁止覆盖当前有效草稿。

## 页面设计

### 故事理解页

- 顶部显示 Script、Fact Ledger、DirectorInterpretation 的 revision/stale 状态与来源版本。
- “故事总览”使用结构化字段编辑主题、冲突、情绪弧和导演要突出/压低的信息。
- “故事时间线”使用阶段轨道和事件卡片；事件详情显示来源引用、证据状态、戏剧功能，可增补假设但不能伪装为原文事实。
- “人物关系图”用角色节点和关系边概览；选择关系后编辑各 phase 状态、转变触发事件、来源与解释。窄屏切为关系清单 + 详情表单。
- 角色和阶段过多时提供筛选/分段，不使用依赖全局重排的复杂力导向布局作为唯一视图。
- 关键事件、线索线、连续性约束、禁止项和未决问题采用可编辑的结构卡片。

### 拍摄计划页

- 展示 `场景 → beat → shot` 层级及 scene/shot 预计时长；不同于故事时间轴，横向或纵向的时间刻度表示成片/场景内时间。
- 选择场景后展开其 beats 与 shots；选择 shot 后编辑画面目标、景别、机位、构图、运镜、时长、切镜理由和连续性状态。
- 提供按场景/人物过滤、总时长与缺字段校验、变更前后镜头数摘要。
- 从现有 `sample_plan` 迁移的条目只标为“导演示例/场次重点”，在用户明确确认前不自动转成 scene、beat 或 shot。

### 风格选择页

- 复用现有风格预设、预览、提示词编辑、AI 推荐及系列继承/覆盖功能。
- 显示已生效风格与未保存选择状态；保存风格不替代 DirectorInterpretation/DirectorShootingPlan 确认。

## 实施切片

1. **工作台壳层与故事理解可视切片**：在 Director 步骤加入三个可访问页签；将旧风格画廊移动至“风格选择”；以结构字段、旧版阶段时间线和人物关系图替代 Profile 的默认 JSON 编辑。旧关系只显示“初始/变化/结局”摘要，不声称有精确阶段来源；保留高级 JSON。
2. **规范化故事地图与可视编辑**：在当前版本化 Director Profile 中加入严格的 `story_map` 结构；旧 Profile 保持只读兼容，不把 legacy relationship summaries 转成精确阶段关系。图、时间轴、剧情线和详情表单共用 phase/event/relationship-state IDs 与 Fact Ledger 引用。
3. **独立拍摄计划**：新建 Pydantic/API/job/persistence/revision contract；AI 生成 scene/beat/shot 草稿；结构化时间轴编辑、总时长和镜头数校验；确认后建立与阐释的 lineage。
4. **下游接线**：Assets 读取确认的 DirectorInterpretation；Storyboard 读取确认的 shot_plan、阐释和资产；拒绝未确认或 stale 上游作为新产物来源。
5. **风格版本 lineage**：如需下游严格复现，再为项目和系列的已保存风格追加 revision/hash；保留现有 art_direction 读兼容。

各切片需独立可构建、可验证、原子提交。第一切片不应宣称已经有 scene/beat/shot 规划功能。

## 验收标准

- 三页签可用鼠标和方向键访问，有清楚的选中、焦点、忙碌、未保存、已确认和 stale 状态；窄屏无横向溢出。
- 故事理解的主编辑流程不要求修改 JSON；图形编辑与键盘表单编辑保持一致。
- 关系时间视图只展示显式阶段关联；旧数据没有阶段依据时显示旧摘要或待确认状态。
- 草稿保存、确认生效、恢复历史是不同操作；刷新/换项目后已保存草稿可恢复。
- DirectorShootingPlan 只有正式 schema/API/lineage 落地后才能成为生成流水线的输入；`sample_plan` 不直接作为 shot list。
- 已有项目和系列风格继承仍能读取、预览、保存和重置；旧 Profile 可读且不会丢失未知字段。
- 相关行为测试、前端 typecheck、生产 build、`git diff --check` 通过。

## 可能受影响路径

- `frontend/src/components/modules/ArtDirection.tsx`
- `frontend/src/components/modules/DirectorProfilePanel.tsx`
- `frontend/src/components/modules/ScriptFactLedgerPanel.tsx`（后续独立切片）
- `frontend/src/store/projectStore.ts`
- `frontend/src/lib/directorProfile.ts`
- `frontend/messages/en.json`、`frontend/messages/zh.json`
- `src/apps/comic_gen/models.py`
- `src/apps/comic_gen/api.py`
- `src/apps/comic_gen/pipeline.py`
- Director、ledger、ArtDirection 与 Assets/Storyboard context 的相关测试

## 实施记录（2026-09-26）

- 已提交 `fb11cc60`：Director 工作台三页签、故事理解结构化字段编辑、阶段列表式时间轴、人物关系图与可折叠高级 JSON。关系图只依据旧 Profile 的人物关系对绘制；旧 `initial/change/final` 仍不标成精确时间状态。
- 已完成并待单独提交：Director Profile 草稿现在嵌入 Script JSON 持久化，支持按 expected draft revision 保存；草稿绑定 source revision。确认前若 source 或 draft revision 已变化，API 返回冲突；确认动作先保存可见修改，再确认其确切草稿版本。项目常规读接口不携带草稿正文，由独立 draft API 读取。
- UI 的故事理解可视编辑仍写入现有 `DirectorProfile` 数据形状，尚未迁移到独立的 `DirectorInterpretation` schema；阶段和关系仍没有稳定 `phase_id/event_id` 与原文范围字段。
- “拍摄计划”页签目前是明确的空态和旧 `sample_plan` 参考展示，不生成、不编辑、不确认正式 scene/beat/shot 计划。它不会把旧场次示例计作镜头或视频任务。
- 风格选择复用原有项目/系列风格保存功能。Director 页签支持方向键切换；UI 测试覆盖编辑、人物关系图、草稿保存与确认分离。前端 typecheck/build 与 `tests/test_director_profile.py` 已通过。

story_map 完成后，拍摄计划仍需新增独立 shooting-plan schema 与草稿/确认版本接口，再实现 scene → beat → shot 可视化编辑与生成；只有在对应的 Assets/Storyboard 消费和 lineage 已明确后，才把确认计划接入下游生成。

## 后续方向：故事结构的可视审阅与编辑（2026-09-26）

### 参考项目观察

检查了公开仓库 [AI-Reader-V2](https://github.com/mouseart2025/AI-Reader-V2) 的 README、`TimelinePage`、`StorylineView`、`GraphPage` 与 `visualization_service`：

- README 描述章节时间轴、按人物分轨的故事线、人物关系图、类型/重要度筛选、章节折叠，以及从人物事件跳到人物卡片。
- `StorylineView` 使用“章节 × 人物”泳道，支持选人物、缩放、查看多人交汇事件；关系图支持类别过滤和两人路径查询。
- 后端按章节事实聚合事件与关系，章节是其主要时间刻度；它是小说分析/阅读视图，不提供导演判断的草稿、修改、确认或拍摄计划契约。
- README 明确提示分析结果可能有错；本参考只证明这些交互模式已被一个公开项目实现，不证明其抽取准确，也不证明图形能自动提升导演决策质量。
- 仓库标注 AGPL-3.0。本项目借鉴交互概念，不复制其源码或组件。

### 采用的架构决定

1. Director 的故事理解加入 `story_map` 作为可版本化的规范结构，并暂时随现有 Director Profile 草稿/确认 revision 一起保存；不另建第二套草稿 revision API。该兼容边界以后若要把 `DirectorInterpretation` 拆成独立资源，再单独迁移。
2. `story_map` 至少包含有稳定 ID 的 `phases → events`、按 `phase_id` 表达的 `relationship_arcs.states`、以及引用事件的 `story_threads.milestones`。时间轴、关系图和剧情线泳道都是同一数据的视图，不各存一份。
3. 事件和关系状态分别记录原文/事实引用及证据状态。可见状态区分剧本明确、导演解释、未确认、冲突；自由文本来源备注不能伪装成精确 source range。所有精确范围绑定剧本 source revision。
4. 剧情时间轴使用阶段/事件顺序；拍摄计划的 scene/beat/shot 时间轴使用镜头/成片时长。两者在数据模型、坐标刻度和用户操作上保持独立。
5. 旧 Profile 的 `timeline` 和 `relationships` 继续可读。旧“初始/变化/结局”只作为 legacy summary；不得自动转换成带具体 `phase_id` 的关系状态。只有用户明确重新分析或在新地图里确认后才进入规范 `story_map`。
6. UI 采用可筛选的多轨事件时间轴、人物关系图 + 按阶段展开的关系状态详情，以及线索/剧情线泳道。选择图节点/边或时间轴事件后，在同一详情面板编辑；键盘可操作的卡片列表是图形编辑的等价路径。力导向图不是唯一视图，也不将拖动节点位置解释为剧情变更。
7. 事件、关系状态、线索节点提供到来源证据的展开/跳转。没有来源引用的 AI 解释应明确显示“未链接原文”，不能因此阻止用户保存导演解释，但不能标记成剧本事实。

### 本迭代目标与边界

- 目标：将规范 `story_map` 结构接入 Director 草稿、确认版本和现有 lineage；提供故事阶段/事件的可视编辑与阶段关系视图；保留 legacy profile 的只读兼容展示。
- 成功条件：服务端拒绝重复/悬空 ID、无效关系参与者/阶段/事件引用、错误来源 revision 和不在固定账本中的 Fact ID；前端时间轴、关系图、剧情线过滤与详情编辑读写同一结构；保存草稿、刷新恢复和显式确认生效沿用既有并发/过期保护；窄屏和键盘可完成相同编辑。
- 暂不做：DirectorShootingPlan、beat/shot 生成、Assets/Storyboard 新 schema 消费、RAG 服务、全本逐事件事实抽取、把旧 profile 自动伪造成规范 story map。
- 假设：当前 source revision 与 Fact Ledger 可作为证据权威；规范 story map 属于用户可修订的导演解释，不覆盖 Fact Ledger。
- 风险边界：AI Reader 的章节泳道适合阅读已聚合事件；iFrame 需要可审阅的编辑计划，因此采用其筛选、折叠、交汇和 drill-down 概念，按 source revision、draft revision 与 explicit apply 约束数据。

### 受影响范围与验证

- 后端：`src/apps/comic_gen/models.py`、`llm.py`、`pipeline.py`、`api.py` 及 Director Profile 行为测试。
- 前端：`frontend/src/store/projectStore.ts`、`frontend/src/lib/directorProfile.ts`、`frontend/src/components/modules/DirectorInterpretationVisualEditor.tsx`、`DirectorProfilePanel.tsx` 及相关 UI 测试。
- 文档：本规格。
- 验收命令：Director Profile pytest；Director UI tests；`npm run typecheck`、`npm run build`、`git diff --check`。
