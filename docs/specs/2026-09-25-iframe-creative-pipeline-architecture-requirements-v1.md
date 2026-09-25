# iframe 创意生产流水线架构与需求分析 v1

## 结论摘要

iframe 需要从“LLM 直接生成 storyboard frames”升级为可暂停、可审阅、可返修的阶段流水线：

```text
Script → Director → Assets → Storyboard → Motion
```

每个阶段都应有独立产物、版本、来源、状态、验证器和用户决策点。AI 可以在预置 prompt/skill 下执行阶段工作，但不能默认跳过用户对叙事结构、角色视觉定义、镜头数量和关键视觉结果的确认。

## 证据分级

### 本地代码事实

- `preview_storyboard_analysis()` 对长文本按约 1600–1800 字切批，逐批调用模型，再用 `frames.extend(batch_frames)` 合并。
- 默认 storyboard prompt 要求“一行包含多个动作时，拆为多帧”；每个返回 frame 直接转换成 `StoryboardFrame`。
- Director Profile 会进入 storyboard prompt，但当前主要是全局导演上下文，没有独立的 `scene_plan`、`beat_plan`、`shot_plan` 产物。
- Assets 阶段的角色、场景、道具主要来自实体提取；导演约束没有成为资产的必需来源字段。
- apply 接口接收用户确认的 draft 后直接持久化，当前没有独立的镜头规划审查或重复合并阶段。

### 外部公开项目观察

以下只读取公开 GitHub README，不代表这些项目的所有运行时行为都已验证：

- [seme-org/open-director](https://github.com/seme-org/open-director)：把 Research、Script、Art Style、Storyboard、Character、Location、Voice、BGM、Media 拆成专门 agent，并以共享 graph state 串联。
- [cherry20-1823/AI-Video-Agent](https://github.com/cherry20-1823/AI-Video-Agent)：将 Planner、Storyboard planner、Prompt builder、Provider 和 Workspace assets 分层。
- [shiqiandiandianda/video-drama](https://github.com/shiqiandiandianda/video-drama)：把中央 Flow Director、剧情演进、分镜表、静态分镜提示词、视频提示词、统一 QA 和 `HUMAN_GATE` 分开；阶段产物有版本和来源，返修用 `RepairTicket`/局部 `STALE`。
- [chan-myay/director-os-video-project](https://github.com/chan-myay/director-os-video-project)：强调 human-directed workflow、长任务后台化、素材审核和分别批准视觉编辑、字幕及 lip-sync。

### 直接推论

这些项目共同支持一个架构方向：编排器不能等同于内容生成器；阶段产物不能等同于最终媒体；长任务不能等同于用户已经批准。

## 目标架构

### 1. Flow Orchestrator

新增逻辑层 `CreativeFlow`，负责：

- 当前阶段和下一合法动作；
- 产物版本、父版本和来源范围；
- prompt/skill 版本；
- QA 结果和用户决策；
- 失败、重试、返修和局部失效；
- 禁止绕过阶段直接创建下游任务。

它不生产内容，只调度阶段 agent/skill，并签发一次性阶段授权。

### 2. Script Stage

产物：`ScriptSource` 与经用户核对的 `ScriptFactLedger`。

包含：

- 原文、章节/集、source range；
- 场景标题、时间、地点、内外景；
- 对白、说话人、动作段落；
- 原文出现的角色、时期变体、道具和关系；
- 长文分段索引和可恢复 batch 状态。
- 事实账本：人物、关系、事件、时间线、场景、来源冲突和未知项，保留 source refs 与事实状态。

禁止把模型推断写回原文事实。

### 3. Director Stage

Director 基于批准的 ScriptFactLedger 工作，产出两个先后衔接、可分别修改、批准和版本化的产物，不能只返回一个混合 Director Profile。

#### `DirectorInterpretation`

表达导演对整集/全片的理解，以及打算怎样引导观众理解和感受：

- 主题、戏剧主线、叙事重点与观众情绪目标；
- 人物目标、人物弧光、关系变化和冲突结构；
- 情绪曲线、关键转折、并行时间线和剧情线；
- 线索/意象的铺设、揭示和回收；
- 希望突出、压低、延迟揭示或保持暧昧的信息及理由；
- 整体风格、表演、视听、节奏和剪辑原则。

每项需区分 `source_fact`、`director_interpretation`、`hypothesis` 和 `user_decision`，并引用 ScriptFactLedger。导演解释不得回写为剧本事实。

#### `DirectorShootingPlan`

用户批准 DirectorInterpretation 后，再具体化为：

1. `ScenePlan`：按时间/地点划场，包含戏剧目的、时长和连续性。
2. `BeatPlan`：场景内事件/动作节拍，引用原文范围。
3. `ShotPlan`：将多个 beat 组织成正式镜头，决定切镜和镜头语言。

`ShotPlan` 最少包含：

- `shot_id`、`scene_id`、`source_refs`；
- 绑定的 `beat_ids`；
- 时长和切镜理由；
- 景别、机位、构图、运镜；
- 屏幕方向、人物空间关系和连续性状态；
- 导演假设与未决问题。

核心规则：一个 shot 可以承载多个 beat；beat 数量不得直接决定 shot 数量。拍摄计划必须引用确切的已批准导演阐释版本。

#### 当前实现与目标差距（本地代码事实）

- `DirectorProfilePanel` 支持异步分析、JSON 草稿编辑、自然语言指令返修，以及用户显式 Apply。
- 用户修改后的草稿状态由前端组件持有；分析/返修结果会作为有保留期限的异步 job 结果保存，但不是可恢复、可比较的权威 draft artifact。点击 Apply 后，profile 才写入服务端。
- 已确认 profile 存在单个 `ArtDirection.director_profile` 字段中，带 revision/hash，但不是可查询的不可变历史 artifact。
- profile 变化时，当前实现会给角色、场景、道具和所有 frames 设置 `director_review_required`；没有按产物依赖关系做定向 stale 计算。
- 当前 profile schema 同时容纳事实摘要、导演阐释、未决项和 `sample_plan`；没有 ScriptFactLedger 或 DirectorShootingPlan 独立产物。
- 仓库还有独立的 `DirectorWorkbench` /“3D 导演台”：它操作 3D 舞台中的角色、路径、姿势和相机，当前界面明确显示仅保存浏览器本地草稿，不调用后端导演台 API。

因此，现有叙事用 DirectorProfile 的“分析 → 手工修改/反馈返修 → Apply”可作为交互迁移起点；目标改造需要补草稿持久化与产物拆分，再引入版本比较、批准 lineage 和精确下游失效。3D 导演台是另一类镜头/表演编辑工具，不是 Script → Director 的剧本理解产物；若未来接入流水线，应由已批准的 ShotPlan 初始化 3D 场景，并把用户确认的 3D blocking/camera 作为镜头执行资料单独保存，不能与 DirectorInterpretation 共用一个状态对象。

### 4. Assets Stage

产物：导演约束下的 `CharacterAsset`、`SceneAsset`、`PropAsset`。

#### 角色资产要求

- 稳定视觉身份：脸型、发型、体型、年龄阶段、显著特征；
- 时期/身份/服装变体；
- 导演确认的表演边界、关系状态和可见情绪范围；
- 角色在不同场景中的可见状态；
- 来源、版本和 `director_interpretation_revision`、`director_shooting_plan_revision`。

#### 场景资产要求

- 地点、时间、内外景和空间结构；
- 关键布景、材质和固定视觉锚点；
- 项目级风格与场景局部光线基线；
- 导演指定的连续性约束。

#### 道具资产要求

- 外观、材质和可见状态；
- 剧情事件导致的状态变化；
- 与角色、场景和 source range 的关联。

Assets 不决定镜头数量或运镜；它提供可被 shot 引用的视觉事实和约束。

### 4.1 分层证据检索

角色设计和分镜返修需要“只取相关剧本证据”，但检索结果不能替代权威结构化产物。采用分层方式：

```text
L0 权威 artifact：ScriptSource / ScriptFactLedger / Director artifacts
  → L1 结构化证据投影：场景、角色时间线、关系状态、道具状态、beat 索引
  → L2 检索适配器：metadata/full-text 优先，必要时再接 vector
  → L3 阶段上下文：Assets / Storyboard / 连续性 QA / 局部返修
```

第一阶段不要求 embedding。先提供按 `scene_id`、`character_id`、时期/阶段、关系状态、`prop_id`、`beat_id`、`shot_plan_id` 和 `source_range` 的稳定查询。角色设计查询角色的时期变体、关系状态、表演边界和来源；分镜查询对应 shot/beat 的对白、动作、空间连续性、光影和环境证据。

后续如果结构化过滤和全文检索对自然语言问题出现可测召回缺口，再增加可重建的 embedding/vector adapter。每次命中都必须返回 `source_revision_id`、`source_range`、相关 fact/scene/character/beat IDs 和 `index_revision`；检索结果只是证据上下文，不能直接成为新事实或批准内容。

### 5. Storyboard Stage

输入只能是已确认的 `ShotPlan`、Assets 和原文对白/声音事实。

产物：一条 `StoryboardFrame` 对应一条 `ShotPlan`，不再由动作摘要自由增加帧数。

必填内容：

- 场景、时间和环境氛围；
- 角色及正确时期变体；
- 表演、视线、表情、姿态和互动；
- 动作物理；
- 光源方向、冷暖和明暗关系；
- 构图、景别、机位、画面位置；
- 运镜、时长、对白、说话人和环境音；
- `shot_plan_id`、source refs、上游版本。

### 6. Motion Stage

Motion 只执行已确认的 storyboard：

- `t2i_i2v`：首帧图 + motion；
- `direct_r2v`：角色/场景参考 + motion。

Motion 不得重新决定场景、角色、镜头数量或构图。发生这些变化时回退到 Director/Storyboard。

## 用户介入设计

AI 自动化不等于自动批准。每一阶段都要支持“生成 → 查看 → 修改/批准 → 推进”。

### 必须人工确认的门

| 阶段 | 用户需要决定的内容 | 默认状态 |
|---|---|---|
| ScriptSource | 原文、分集范围和源文本版本 | `DRAFT` |
| ScriptFactLedger | 人物/关系/事件事实、来源冲突和未知项 | `HUMAN_REVIEW` |
| DirectorInterpretation | 主题、人物弧光、冲突/情绪/线索线、风格和剧情重点 | `HUMAN_REVIEW` |
| DirectorShootingPlan | 场景边界、beat-shot 组合、镜头数量、时长和切镜理由 | `HUMAN_REVIEW` |
| Assets | 角色视觉锚点、时期变体、场景基准图、导演风格 | `HUMAN_REVIEW` |
| Storyboard | 镜头表、首帧构图和完整描述 | `HUMAN_REVIEW` |
| Motion | 执行模式、模型、时长、成本和批量范围 | `APPROVAL_REQUIRED` |

用户可选择：

- 批准整个阶段；
- 只批准选中的场景/镜头；
- 锁定字段后局部返修；
- 提供自然语言反馈，由当前阶段 skill 返修；
- 退回上游阶段；
- 取消下游任务创建。

### 不应默认阻塞的内容

机械格式检查、JSON 解析、source range 校验、资产引用完整性和重复 ID 检查可以自动执行。视觉/叙事判断不能以自动 PASS 代替用户决策。

## Prompt / Skill 运行模型

每次阶段调用必须记录：

- `skill_id` 和 skill revision；
- prompt template revision；
- model/provider/version；
- 输入产物版本；
- 用户反馈和批准记录；
- 输出产物版本及校验结果。

Skill 只负责本阶段生产或验证，不得跨阶段隐式修改上游事实。

推荐角色：

- `flow_director`：编排和授权；
- `script_fact_extractor`：来源锚定的事实账本与冲突整理；
- `director_interpreter`：主题、人物、冲突、情绪/线索线和创作方向；
- `shot_plan_director`：在批准的阐释下生成场景/beat/shot 拍摄计划；
- `creative_asset_director`：角色、场景和道具视觉定义；
- `storyboard_writer`：完整分镜描述；
- `motion_prompt_director`：运动执行描述；
- `unified_qa`：结构校验、连续性检查和返修路由。

## 长文本架构要求

现有分批恢复能力应保留，但职责要调整：

1. Script 阶段负责 source range、分段索引和带引用的局部事实抽取。
2. Reduce 汇总全篇事实账本、时间线、关系、场景候选与冲突；用户先审阅事实。
3. `DirectorInterpretation` 基于全篇事实账本和完整剧情生成；用户审阅批准整体理解和创作方向，不能直接拼接局部 batch 的情绪判断。
4. `DirectorShootingPlan` 再把已批准的整体方向具体化为全局 scene/beat/shot，跨批次合并后由用户确认镜头数和节奏。
5. 只有已批准的 DirectorInterpretation 与 DirectorShootingPlan 才进入 Assets/Storyboard。
6. batch 重试只能替换对应 source range；不得重复追加旧结果。
7. 每批结果必须带 `source_ref`、输入版本和 batch revision。

## 版本和局部失效

建议产物关系：

```text
Script v3
  → ScriptFactLedger v3.1
  → DirectorInterpretation v3.1
  → DirectorShootingPlan v3.1
  → Assets v3.1
  → Storyboard v3.1
  → Motion v3.1
```

修改规则：

- 修改 ScriptSource/FactLedger：下游 DirectorInterpretation、DirectorShootingPlan、Assets、Storyboard、Motion 标记 `STALE`；
- 修改 DirectorInterpretation：下游 DirectorShootingPlan、Assets、Storyboard、Motion 标记 `STALE`；
- 修改 DirectorShootingPlan：按场景/角色引用使相关 Assets、Storyboard、Motion 标记 `STALE`；
- 修改单个角色资产：只使引用该角色的 Storyboard/Motion 标记 `STALE`；
- 修改单个 Storyboard：只使该镜头 Motion 标记 `STALE`。

## 状态模型

```text
DRAFT
RUNNING
READY_FOR_REVIEW
HUMAN_REVIEW
APPROVED
REPAIR_REQUIRED
STALE
RUNNING_DOWNSTREAM
COMPLETED
FAILED
```

阶段推进必须满足：

```text
上游产物存在
→ 自动 QA PASS
→ 用户 APPROVED
→ FlowAuthorization 签发
→ 下游执行
```

## MVP 建议

第一阶段不做完整 agent graph，按用户决策顺序先打通以下契约：

1. `ScriptFactLedger`：可校对的来源事实、冲突与未知项；
2. `DirectorInterpretation`：可编辑、保存、返修、比较版本、批准生效的导演阐释；
3. `DirectorShootingPlan`：只在导演阐释被批准后生成，包含 `scene_plan + beat_plan + shot_plan`，可独立审阅和批准；
4. `CreativeAssetProfile`：角色/场景/道具的导演化定义，并引用两个批准的 Director revisions；
5. 结构化证据投影与查询：支持 Assets、Storyboard 和局部返修按对象/阶段取证据；
6. `StoryboardFrame` 必须绑定 `shot_plan_id` 和明确的上游 revisions。

早期 UI 可以沿用 DirectorProfilePanel 的分析/反馈/应用交互作迁移入口，但必须把其单一 JSON 草稿拆成可读、可局部编辑的事实账本和导演阐释视图；拍摄计划使用按场景和镜头组织的表格/列表，不要求用户直接编辑原始 JSON。草稿保存、批准生效应为不同操作。

第一集 158 条旧记录只做审计和迁移，不直接复用为 motion 输入。

## 外部参考的采用边界

可借鉴：

- OpenDirector 的专门 agent 分工和共享状态；
- AI-Video-Agent 的 Planner / Provider / Workspace 分层；
- video-drama 的中央编排、QA、HUMAN_GATE、版本和局部返修；
- Director OS 的长任务后台化和分步骤人工批准。

不能直接证明：

- 这些项目的模型质量或镜头数量一定合理；
- 它们的内部实现适合 iframe；
- 它们的 agent 输出可以直接作为 iframe 的数据契约。

## 需要产品确认的问题

1. 用户是否可对低风险场次批量批准 DirectorShootingPlan，同时保留逐场/逐镜锁定和返修？
2. Assets 阶段是否必须人工确认角色/场景视觉基准图？
3. Storyboard 首帧是否作为强制人工门，Motion 是否只能从批准的首帧启动？
4. 是否允许用户选择“自动推进模式”，以及哪些批准能预先授权自动通过？
5. 第一集迁移是生成新的完整项目版本，还是在旧版本上创建可比较的 storyboard revision？
