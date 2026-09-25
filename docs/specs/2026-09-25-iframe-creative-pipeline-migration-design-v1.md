# iframe 创意流水线迁移设计 v1

## 状态

架构设计草案，供评审。本文不表示代码已实现，也不把线上第一集 158 条旧 frame 当作已确认镜头。

## 基线边界

必须分开看待两个代码状态：

- **线上基线**：`7a85c231`，包含 storyboard 分批恢复和视觉原子拒绝校验。
- **当前功能代码基线**：`7f2c892b`。当前仓库 `HEAD` 为 `f7fd74b5`，它及其前一条提交 `56849e2e` 只增加了架构/工作流文档，没有改变功能代码；`7f2c892b` 不是线上 `7a85c231` 的后代。该代码树中 Director Profile、Storyboard Analysis Job 已存在，但 storyboard 路径与线上分批实现不同。

迁移实现前必须先选定并同步正确的代码基线。不能把当前工作树观察直接写成线上运行事实，反之亦然。

## 现有模块映射

| 当前实现 | 当前职责 | 目标架构位置 | 缺口 |
|---|---|---|---|
| `Script` / `parse_novel()` | 保存原文并抽取人物、场景、道具 | Script | 缺少可追溯、可修订的事实与连续性账本 |
| `DirectorProfile` | 情绪弧、节奏、视觉语言、表演/声音方向、连续性约束 | Director 参考上下文 | 现有导演判断未与事实台账、剧情阐释和拍摄计划分层版本化 |
| `Character` / `Scene` / `Prop` | 实体字段、参考资产、生成状态 | Assets | 缺少完整导演视觉规格及与 shot/source 的稳定来源关系 |
| storyboard analysis jobs | 生成/修订 draft，持久化 job 状态 | 阶段执行和恢复基础设施 | job result 是阶段 JSON，不等于完整 workflow/artifact lineage |
| `StoryboardFrame` | 镜头/图像/视频相关字段聚合 | Storyboard + 部分 Motion 投影 | 缺少 `shot_plan_id` 强绑定和独立 revision |
| `VideoTask` / frame actions | provider 任务与结果 | Motion | 没有强制依赖已批准 Storyboard revision 的 admission contract |

## 目标对象和持久化边界

### CreativeFlow

建议新增项目/集级流程聚合，不继续把所有状态塞入 `Script`：

```text
CreativeFlow
  id
  owner_profile_id
  project_id
  status
  created_at
  updated_at
```

`CreativeFlow` 只负责项目级流程状态，不持有一个无法代表多产物并行版本的全局 `active_revision_id`。每个逻辑产物各有自己的 draft/approved head。

### Artifact revision 与 head

内容权威落在结构化、可版本化的 artifact 上，而不是分散在业务对象里的互不关联 revision/hash 字段。artifact payload 可按领域 schema 存 JSON；逻辑模型不预先绑定某种数据库。Revision 是不可变快照：任何用户修改或 AI 返修都创建新的 `revision_id`，不原位覆盖已批准内容。

```text
ContentArtifactRevision
  revision_id
  artifact_key           # script_source, director_interpretation, storyboard_shot:{shot_id}, ...
  flow_id
  stage                 # script | director | assets | storyboard | motion
  revision_number
  parent_revision_ids[]
  input_refs[]           # exact artifact revision IDs consumed
  source_refs[]          # source artifact revision + range/locator
  payload
  content_hash           # integrity/dedup aid; not a revision identity
  prompt_id / prompt_revision
  skill_id / skill_revision
  model_provider / model_id
  created_by             # ai | user | system
  created_at

ArtifactHead
  flow_id
  artifact_key
  draft_revision_id
  approved_revision_id

ArtifactReviewEvent
  event_id
  revision_id
  decision               # approve | reject | request_revision | lock_fields
  actor_id / actor_type
  field_paths[]
  comment
  created_at

ArtifactJob
  job_id
  stage
  input_revision_ids[]
  prompt_id / prompt_revision
  skill_id / skill_revision
  model_provider / model_id
  status / progress / error
  output_revision_ids[]
  idempotency_key
  created_at / completed_at
```

`artifact_key` 是逻辑产物身份，`revision_id` 是内容版本身份；例如一个 ShotPlan revision 可以改变镜头集合，而每条 StoryboardShot 另有稳定 shot identity 和自身 revisions。`content_hash` 用于内容相等/完整性检查，不能替代 revision ID，也不能单独证明来源、批准或下游依赖。

审批不修改 revision 内容。一次批准以 `ArtifactReviewEvent` 记录，并在同一持久化事务内把相应 `ArtifactHead.approved_revision_id` 指向已审阅 revision。保存草稿也创建可恢复的 revision，只更新 draft head；不能隐式推进下游。

下游任务必须 pin 确切 `input_revision_ids`。新上游批准版本与下游输入不一致时，依赖投影将后者显示为 `stale`；历史 revision 本身不被改写，用户可选择基于新版本局部返修、重做或继续查看旧结果。受影响对象由依赖边和字段范围计算，不用项目级单一 `director_review_required` 布尔值代替。

### 物理存储边界

- 结构化 artifact revision、head、review event 和依赖关系必须处于支持一致提交/并发控制的权威持久化层；revision 内容可以是 schema 校验的 JSON payload。
- 当前本地代码的 `output/projects.json` / `output/series.json` 覆盖式保存和临时 job SQLite 不能单独满足不可变历史与多记录原子更新的目标。
- 线上实际 API/数据库/文件存储与备份配置尚未核验。实现前先确认生产真实权威存储及事务边界，再选择复用或迁移持久化 adapter；不能因本地开发使用 JSON 文件就假定生产也相同。
- 新旧兼容期必须明确单一写入权威。旧 `Script` / `StoryboardFrame` 可作为兼容读模型/投影；批准动作在一次事务内创建 revision、review event、更新 head 并更新必要投影，避免双写后两边都声称是最新。

### Job 与 Artifact 的区别

- **Job** 是一次可恢复的计算尝试：排队、运行、失败、重试、进度。
- **Artifact revision** 是可审阅/批准/引用的内容版本。
- 一个 Job 可以产出一个或多个临时 batch result；只有聚合、结构验证成功后才创建可审阅的 artifact revision。
- Job 完成不代表 Artifact 已批准。
- Job fingerprint/idempotency key 用于重复请求控制，不代表内容版本或批准 lineage。

复用现有 `ExtractionJobs` 作为迁移初期的异步执行基础，但后续需记录准确输入 revision，并把结果交给 artifact store 管理。线上分批恢复能力可通过 batch checkpoint adapter 迁移，不让 UI 直接依赖 SQLite batch 表结构。

## 阶段数据契约

### 当前第一集输出的归属建议

以下判断依据用户提供的 JSON 形状，不代表已核验其相对原剧本的准确性：

| 当前字段 | 建议归属 | 处理方式 |
|---|---|---|
| `canon_state`、人物/关系/事件/时间线事实、`scene_summaries`、来源与冲突 | `ScriptFactLedger` | 保存原文引用、事实状态和冲突；让用户校正抽取事实 |
| `emotional_arc`、`pacing`、`visual_language`、`performance_direction`、`dialogue_direction`、`sound_direction` | `DirectorInterpretation` | 保留为导演对戏剧和拍法的明确立场，关联事实依据并开放修改/确认 |
| `setting`、`timeline`、`relationships`、`key_events` | 按字段拆分事实与解释 | 不能整块直接归为事实账本；例如时间线事件是来源事实，`function`、`weight` 和主题概括是导演判断 |
| `continuity_constraints`、`prohibitions`、`unresolved_questions` | 分类型保存 | 连续性事实、改编约束、导演边界和开放问题分别标记来源与责任人 |
| `sample_plan` | Director 工作摘要 | 不能代替完整的 scene/beat/shot 计划；转为拍摄计划前需明确全局覆盖范围与镜头拆分 |
| `execution_summary` | 非规范展示投影 | 不重复存储前述内容；如旧 prompt 兼容仍需文本摘要，应从规范 artifact 生成且标明非权威 |

因此，当前结果不是一个要原样交给 Assets 的 Director 对象，而是 Script 事实提取、导演阐释和局部拍摄建议的混合包。迁移时应拆分归属、补足来源，并让用户分别校对事实、确认创作判断和批准镜头规划。

### ScriptFactLedger v1

这是 Script 阶段供导演使用的证据底稿，不负责替导演决定故事重点。记录原文明确事实、source refs、时间/人物/关系状态、冲突和未知项。事实修订保留来源与修订者；模型推断不得伪装成原文事实。

### DirectorInterpretation v1

导演先给出对剧本的理解和创作判断。此交付物回答“这故事讲什么、观众应该经历什么、我打算如何引导观众看见它”，而不是镜头列表。建议包含：

- 核心主题、戏剧主线及希望观众带走的感受；
- 人物目标、关系变化、人物弧光，以及人物之间的冲突结构；
- 情绪曲线、关键转折、时间线和并行剧情线；
- 线索、意象、反复出现的空间/道具及其铺设、回收位置；
- 希望突出、压低、延迟揭示或保持暧昧的剧情信息，并说明依据；
- 总体风格，以及表演、视听、节奏和剪辑原则；
- 事实引用、导演假设、矛盾和待用户决策项。

`DirectorInterpretation` 必须引用 `ScriptFactLedger` revision，并标注每项为 `source_fact`、`director_interpretation`、`hypothesis` 或 `user_decision`。对忠实改编的未知剧情，不得自行补成既定事实；用户可明确授权为创作性补写。

### DirectorShootingPlan v1

导演阐释经用户审阅后，再落为可执行的场景、节拍和镜头规划。它回答“具体拍什么、怎么组织镜头”，并引用已批准的阐释 revision。

```json
{
  "interpretation_ref": "director-interpretation-rev-1",
  "scenes": [{
    "scene_id": "scene-01",
    "source_refs": ["source:chars-0-520"],
    "location": "电影院入口",
    "time": "傍晚",
    "duration_seconds": 8,
    "continuity_in": "两人从街道一侧走近",
    "continuity_out": "两人进入电影院入口"
  }],
  "beats": [{
    "beat_id": "beat-01",
    "scene_id": "scene-01",
    "source_refs": ["source:chars-20-120"],
    "description": "周涵牵着沈夏走近入口",
    "duration_seconds": 6
  }],
  "shots": [{
    "shot_id": "shot-01",
    "scene_id": "scene-01",
    "beat_ids": ["beat-01"],
    "duration_seconds": 6,
    "cut_reason": null,
    "shot_size": "全景",
    "camera_angle": "平视",
    "composition": "入口位于画面右侧，两人从左侧进入",
    "camera_movement": "缓慢侧后方跟拍"
  }],
  "unresolved_questions": []
}
```

合同规则：

- DirectorInterpretation 与 DirectorShootingPlan 是不同可审阅产物，可分别保存、修订和批准；拍摄计划不能反向覆盖导演阐释。
- DirectorInterpretation 覆盖整集/全片的戏剧结构与创作意图；拍摄计划按场景、beat、shot 具体化，保持对上层意图的引用。
- Scene / Beat / Shot ID 由服务器或确定性 validator 创建，不信任模型自造 ID。
- 每个 Beat 必须引用合法 source range。
- Shot 必须引用一个或多个 Beat。
- Beat 可共享一个 Shot；同一 Beat 默认只归一个 Shot，除非用户明确允许跨镜头覆盖。
- 分镜总时长、scene 时长和总片长之间执行容差检查，超限交用户决定，不能静默扩张。

### CreativeAssetProfile v1

通过独立 profile 与现有资产解耦，逐步映射到 Character/Scene/Prop：

```text
CreativeAssetProfile
  asset_id
  asset_kind
  identity / visual_anchors
  temporal_variant
  costume_variant
  performance_boundaries
  scene_continuity
  source_refs[]
  director_revision
  reference_media[]
  status
```

第一版以附加 profile 兼容旧资产，不直接重写/迁移现有 `Character`、`Scene`、`Prop` 核心字段。

### StoryboardShot v1

- `shot_plan_id` 必填；
- 角色、场景、道具引用必须指向 Assets artifact revision；
- `source_refs` 和 `director_revision` 必填；
- scene、表演、动作物理、光影、构图、运镜、时长、对白和音频按字段验证；
- apply 只能应用用户正在审阅且上游 revision 未变化的 draft；过期时返回 409 并要求刷新，不允许静默覆盖。

### MotionIntent v1

- 强制引用 `storyboard_artifact_id + storyboard_shot_id`；
- 保存模式 `t2i_i2v | direct_r2v`、输入首帧/参考资产、motion prompt、provider/model 和成本参数；
- 只有 Storyboard artifact 状态为 `approved` 且未 `stale` 时才允许提交 provider task；
- 同一 shot 可有多个可比较的 MotionIntent revision，但不能增加/删除 Storyboard shots。

## 用户决策与状态转换

```text
stage job completed
  → deterministic QA passed
  → READY_FOR_REVIEW
  → user: approve | revise | lock fields | reject | return upstream
  → APPROVED
  → orchestrator authorizes next stage
```

默认门：

1. 用户先批准 DirectorInterpretation，再确认 DirectorShootingPlan 的场景边界、shot 数量和时长计划。
2. Assets 必须确认角色身份/时期变体和核心视觉锚点；大批次允许逐角色批准。
3. Storyboard 必须确认 shot list；首帧图像可按镜头批量批准或单镜批准。
4. Motion 提交前必须确认执行模式、模型、时长、数量和成本摘要。

用户可以启用“自动推进”偏好，但自动推进只能通过用户显式批准的策略执行，并保留每阶段暂停、回退、取消和审计记录。初始默认不开启。

## Director 解读审阅与生效

Director 不应是一个不可分辨的长文本或一次性 JSON。用户先审阅 ScriptFactLedger，再审阅 DirectorInterpretation，最后审阅 DirectorShootingPlan；三个产物分别回答“剧本明确提供了什么”“导演如何理解并引导剧情”“具体如何拆场、拆 beat、组织 shot”。Director 的两个产物都是可编辑的结构化 draft，不能在生成完成后自动成为下游有效输入。**保存草稿**保留未确认修改；**批准并生效**将指定 revision 设为当前版本并开放相应下游阶段。

### 审阅内容

审阅需区分 ScriptFactLedger 与 Director 两个阶段，并能从任一字段跳转到对应剧本来源：

- **ScriptFactLedger 审阅**：时间线、人物/关系状态、事件、场景事实；显示 source refs、事实/推断状态、相互冲突的来源。纠正原文提取应修订 Script 产物，不能只在 Director 文案里悄悄改事实。
- **DirectorInterpretation 审阅**：故事主旨、戏剧主线、人物目标与弧光、冲突关系、情绪曲线、时间线/线索线、剧情强调与揭示次序、总体风格和视听/表演原则。每项区分来源事实、导演解释、假设和用户决策。
- **DirectorShootingPlan 审阅**：场景边界、地点/时间、场景目标、预计时长和连续性；每个 beat 的戏剧变化；beat 如何组合为 shot、镜头数/时长、切镜理由、景别、机位、构图和运镜。
- **待确认项**：来源冲突、导演假设与创作选择。用户可以回答、保留为未决，或明确授权创作性补写；未决事实不得被静默转成剧情事实。

用户可修改导演阐释中的主题、剧情重点、人物/冲突/情绪判断与风格原则；也可增删/合并拍摄计划中的场景、beat 和 shot，调整 beat-shot 归属、补充导演说明，并对决策执行“确认”“锁定”或“留待决定”。批量操作必须显示作用范围和受影响镜头数。锁定项在后续 AI 修订中作为约束；AI 只能提出带差异的建议，不能静默改写锁定值。

### 保存、批准和生效

```text
ScriptFactLedger draft
  → 用户校正/批准事实底稿
  → DirectorInterpretation draft
  → 用户编辑/批准导演阐释
  → DirectorShootingPlan draft
  → 用户编辑/批准场景与镜头计划
  → Assets job 显式引用已批准的 DirectorInterpretation 与 DirectorShootingPlan revisions
  → Storyboard job 显式引用已批准的 DirectorShootingPlan revision
```

- 保存不会自动推进阶段；离开页面后可以继续编辑同一 draft 或从它派生新 revision。
- DirectorInterpretation 批准前显示主题/人物/情绪/线索等决策摘要、假设和未决项；DirectorShootingPlan 批准前显示场景数、shot 数、总时长、beat 覆盖率和校验结果。存在结构错误时不能批准；未决项则显示影响，由用户决定是否允许带着这些项继续。
- 批准后产物不可原地覆盖。修订会生成新 revision，记录变更字段、操作者、时间及变更原因；用户可比较任意两个 revision，并选择哪个版本生效。
- Assets 必须引用确切的 DirectorInterpretation 与 DirectorShootingPlan revisions；Storyboard 必须引用确切的 DirectorShootingPlan、DirectorInterpretation 和 CreativeAssetProfile revisions，不能读取“最新内容”这种可变指针。
- 已有下游产物不会因 Director 修订而被静默修改或自动重跑。系统根据依赖字段将受影响产物标成 `stale`，说明受影响对象；用户选择局部返修、重新生成或保留旧版本。新的下游任务只接受用户选定且符合阶段门的有效版本。
- 初始版本需记录 AI 生成内容、用户编辑和最终批准者，避免将模型建议误认为用户确认的故事事实。

这样，Script 事实核对、导演创作决策和拍摄拆解各有独立的人机审阅点。“保存”解决继续编辑与恢复，“批准并生效”解决版本选择和下游授权；两者不能共用一个含糊的保存按钮语义。

## API 边界草案

```text
POST /creative-flows/{flow_id}/stages/{stage}/jobs
GET  /creative-flows/{flow_id}/jobs/{job_id}
GET  /creative-flows/{flow_id}/artifacts?stage=...
GET  /creative-flows/{flow_id}/artifacts/{artifact_id}
POST /creative-flows/{flow_id}/artifacts/{artifact_id}/approve
POST /creative-flows/{flow_id}/artifacts/{artifact_id}/revise
POST /creative-flows/{flow_id}/artifacts/{artifact_id}/reject
POST /creative-flows/{flow_id}/artifacts/{artifact_id}/lock-fields
POST /creative-flows/{flow_id}/artifacts/{artifact_id}/motion-intents
```

现有 endpoints 在迁移期作为兼容 facade：

- Director Profile endpoints 映射为 director artifact；
- entity extraction / project reparse 映射为 Script/Assets draft；
- storyboard-analysis-jobs 映射为 storyboard draft job；
- storyboard apply 转为对已 review artifact 的 approve/apply 操作；
- video_tasks admission 校验 storyboard approval lineage。

## 长文本执行设计

将长文读取和全局决策分开：

1. **Map**：按原文 source range 分批抽取场景候选、beats、实体引用和局部连续性，不生成正式 shots。
2. **Reduce**：跨 batch 合并来源事实、场景候选、关系/时间线和连续性，生成 ScriptFactLedger draft。
3. **DirectorInterpretation**：基于经核对的全局账本形成戏剧主线、人物/情绪/线索线、叙事重点和风格决策；用户审阅批准。
4. **DirectorShootingPlan**：依据已批准的导演阐释形成全局 scene/beat/shot 计划；用户审阅镜头数量、时长与拆分后批准。
5. **Assets**：按已批准导演阐释和拍摄计划中的角色时期/场景定义生成资产 profile。
6. **Storyboard**：按已批准 shot 分批写详细字段，带 shot_id/source_refs；聚合校验后展示。

checkpoint key 必须包含 flow、stage、input artifact revision、source range、prompt/skill revision、model id。上游版本改变时仅失效相关 checkpoint。跨批次重复通过 source coverage/beat identity validator 发现并送回 reduce 阶段处理，不将 batch 输出直接 append 为正式 shots。

## 迁移切片

### Slice 0：基线对齐与只读审计

- 确认目标分支包含线上 `7a85c231` 及期望的 iframe 后续提交；
- 导出第一集原始剧本、158 draft rows、source ranges、Director Profile 和当前资产；
- 离线生成 duplicate/scene/beat/shot 候选审计，不修改线上数据；
- 结果：记录可复现的旧数据基线。

### Slice 1：ScriptFactLedger 与 Director drafts

- 保留 Director Profile 作为兼容输入；新增 ScriptFactLedger、DirectorInterpretation、ScenePlan/BeatPlan/ShotPlan 的 draft schema 和异步 job；
- map/reduce 输出有来源的事实与场景候选，不把局部 batch 当作导演最终判断；
- DirectorInterpretation 全局生成并设置独立 review/approve 门；
- DirectorShootingPlan 引用已批准阐释，独立 review/approve 后再供 Storyboard 使用；
- 所有用户修订保存为 artifact revision，追踪下游失效关系。

### Slice 2：导演化资产 profile

- 新增附加式 CreativeAssetProfile；
- 为角色加入稳定视觉锚点、时期变体、表演边界和来源；
- 为场景加入空间锚点、时间/光线基线、来源；
- 提供逐资产批准和对引用它的下游 artifact 的局部失效。

### Slice 3：Storyboard 一镜一条

- 新 generation path 只接受批准的 ShotPlan；
- 每条 StoryboardShot 必须带 shot_plan_id；
- 同时检查字段完整性、beat coverage、scene duration、duplicate、跨批次连续性；
- 不合格进入 targeted repair，不重新生成整集。

### Slice 4：Motion admission 和用户成本门

- MotionIntent 必须引用批准的 Storyboard revision；
- 首帧驱动和角色参考驱动只是同一 shot 的 execution mode；
- 生成前展示模型、时长、批量数量及可用成本信息；
- 支持按 shot 暂停、重试、取消和比较结果。

### Slice 5：兼容与旧数据迁移

- 保持历史 Script/StoryboardFrame 可读；
- 旧 frame 不自动获得 ShotPlan 绑定或批准状态；
- 旧视频任务保持其历史 lineage，不伪造新架构批准记录；
- 新旧 workflow 由明确 schema/version 分流，禁止猜测性 backfill。

## 验收门

- 对批准 DirectorShootingPlan 的每个 Shot，恰好有一个正式 Storyboard shot revision；
- Beat 数量可以大于 Shot 数量，系统不会将其误转成更多镜头；
- source range 完整覆盖率可测，模型不能伪造来源范围；
- 未批准或已 stale 的 Storyboard 无法创建 Motion provider task；
- 用户修改一个 shot 不会重新生成整集；
- 用户可查看 AI 产物、模型/prompt/skill revision、来源和修改历史；
- 158 条历史结果不会自动升级成 158 个已确认镜头。

## 仍需明确的产品决定

本文为安全默认值建议，最终实现前应确认：

1. 是否采用 ScriptFactLedger → DirectorInterpretation → DirectorShootingPlan 三个明确审阅产物，并要求导演阐释批准后才能生成拍摄计划；
2. Assets 的视觉参考图是否属于必需审批门，还是只审批文字 profile；
3. 首帧是否所有模式都必须人工确认；
4. 自动推进是否先不提供，之后作为项目级 opt-in；
5. 第一集应创建并行 storyboard revision，保留旧 158 条作对比，而不是覆写旧数据。
