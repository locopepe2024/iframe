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
| `Script` / `parse_novel()` | 保存原文并抽取人物、场景、道具 | Script | 事实提取与导演规划尚未分离为独立版本产物 |
| `DirectorProfile` | 情绪弧、节奏、视觉语言、表演/声音方向、连续性约束 | Director 上下文 | 缺少可审阅的 ScenePlan、BeatPlan、ShotPlan |
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
  active_revision_id
  status
  created_at
  updated_at
```

### StageArtifact

所有阶段结果采用不可变 revision，修订创建新 revision：

```text
StageArtifact
  id
  flow_id
  stage                 # script | director | assets | storyboard | motion
  revision
  parent_artifact_ids[]
  source_refs[]
  payload
  status                # draft | ready_for_review | approved | stale | failed
  prompt_id / prompt_revision
  skill_id / skill_revision
  model_provider / model_id
  created_by            # ai | user | system
  approved_by / approved_at
  qa_result
  created_at
```

阶段产物不可覆盖已批准版本。`active_revision_id` 只指向用户当前选择的版本。

### Job 与 Artifact 的区别

- **Job** 是一次可恢复的计算尝试：排队、运行、失败、重试、进度。
- **Artifact** 是可审阅/批准/引用的内容版本。
- 一个 Job 可以产出一个或多个临时 batch result；只有聚合、结构验证成功后才创建 `StageArtifact`。
- Job 完成不代表 Artifact 已批准。

复用现有 `ExtractionJobs` 作为异步执行基础，但后续需扩展为 stage-aware job，并保留独立 artifact store。线上分批恢复能力可通过 batch checkpoint adapter 迁移，不让 UI 直接依赖 SQLite batch 表结构。

## 阶段数据契约

### DirectorPlan v1

```json
{
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
  "unresolved_questions": [],
  "hypotheses": []
}
```

合同规则：

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

1. DirectorPlan 必须用户确认场景边界、shot 数量和时长计划。
2. Assets 必须确认角色身份/时期变体和核心视觉锚点；大批次允许逐角色批准。
3. Storyboard 必须确认 shot list；首帧图像可按镜头批量批准或单镜批准。
4. Motion 提交前必须确认执行模式、模型、时长、数量和成本摘要。

用户可以启用“自动推进”偏好，但自动推进只能通过用户显式批准的策略执行，并保留每阶段暂停、回退、取消和审计记录。初始默认不开启。

## Director 解读审阅与生效

Director 输出必须作为可编辑的结构化 draft 展示，不能只展示模型生成的长文本，也不能在生成完成后自动成为 Assets 的有效输入。建议分成两个明确操作：**保存草稿**保留尚未确认的修改；**批准并生效**将指定 revision 设为当前 Director 版本，并允许 Assets 基于它开始工作。

### 审阅内容

同一审阅工作区至少提供以下分区，并能从字段跳转到对应剧本来源：

- **故事事实**：时间线、人物关系、事件、场景事实；显示 source refs、事实状态和来源冲突。
- **导演判断**：情绪弧、节奏、视觉/表演/对白/声音方向；与事实分开展示。
- **分场计划**：场景边界、地点/时间、人物、场景目标、预计时长和连续性。
- **节拍与镜头计划**：每个 beat 的动作/戏剧变化，以及 beat 如何组成 shot、预计镜头数/时长、切镜理由和构图运镜。
- **待确认项**：未决问题、导演假设和来源冲突；用户可以回答、保留为未决，或明确排除其对下游的影响。

用户可编辑字段、增删/合并场景和镜头、调整 beat-shot 归属、补充导演说明，并对字段执行“确认”“锁定”或“留待决定”。批量操作必须显示作用范围和受影响镜头数。锁定字段在后续 AI 修订中作为约束；AI 只能提出带差异的建议，不能静默改写锁定值。

### 保存、批准和生效

```text
AI draft
  → 用户编辑（持续保存为 draft revision）
  → 结构/来源/时长校验
  → 用户批准指定 revision
  → revision 成为 active DirectorPlan
  → Assets job 显式引用该 DirectorPlan revision
```

- 保存不会自动推进阶段；离开页面后可以继续编辑同一 draft 或从它派生新 revision。
- 批准前显示场景数、shot 数、总时长、未解决项和校验结果。存在结构错误时不能批准；未决项则显示明确影响，由用户决定是否允许带着这些项继续。
- 批准后产物不可原地覆盖。修订会生成新 revision，记录变更字段、操作者、时间及变更原因；用户可比较任意两个 revision，并选择哪个版本生效。
- Assets、Storyboard 必须引用确切的上游 artifact revision，不能读取“最新内容”这种可变指针。
- 已有下游产物不会因 Director 修订而被静默修改或自动重跑。系统根据依赖字段将受影响产物标成 `stale`，说明受影响对象；用户选择局部返修、重新生成或保留旧版本。新的下游任务只接受用户选定且符合阶段门的有效版本。
- 初始版本需记录 AI 生成内容、用户编辑和最终批准者，避免将模型建议误认为用户确认的故事事实。

这样，“保存”解决继续编辑与恢复，“批准并生效”解决版本选择和下游授权；两者不能共用一个含糊的保存按钮语义。

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
2. **Reduce**：跨 batch 合并场景边界/连续性，产生全局 DirectorPlan draft。
3. **Human review**：用户看完整场次和 shot count，再批准 DirectorPlan。
4. **Assets**：按被批准的角色时期/场景定义生成资产 profile。
5. **Storyboard**：按 shot 分批写详细字段，带 shot_id/source_refs；聚合校验后展示。

checkpoint key 必须包含 flow、stage、input artifact revision、source range、prompt/skill revision、model id。上游版本改变时仅失效相关 checkpoint。跨批次重复通过 source coverage/beat identity validator 发现并送回 reduce 阶段处理，不将 batch 输出直接 append 为正式 shots。

## 迁移切片

### Slice 0：基线对齐与只读审计

- 确认目标分支包含线上 `7a85c231` 及期望的 iframe 后续提交；
- 导出第一集原始剧本、158 draft rows、source ranges、Director Profile 和当前资产；
- 离线生成 duplicate/scene/beat/shot 候选审计，不修改线上数据；
- 结果：记录可复现的旧数据基线。

### Slice 1：DirectorPlan draft artifact

- 保留 Director Profile；新增 ScenePlan/BeatPlan/ShotPlan draft schema 和异步 job；
- 批处理只产出带 source refs 的局部计划；
- reduce 阶段产全局计划；
- 增加 stage artifact revision 和用户 review/approve；
- Storyboard 暂时仍使用现有 apply，但要求引用已批准 shot plan。

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

- 对批准 DirectorPlan 的每个 Shot，恰好有一个正式 Storyboard shot revision；
- Beat 数量可以大于 Shot 数量，系统不会将其误转成更多镜头；
- source range 完整覆盖率可测，模型不能伪造来源范围；
- 未批准或已 stale 的 Storyboard 无法创建 Motion provider task；
- 用户修改一个 shot 不会重新生成整集；
- 用户可查看 AI 产物、模型/prompt/skill revision、来源和修改历史；
- 158 条历史结果不会自动升级成 158 个已确认镜头。

## 仍需明确的产品决定

本文为安全默认值建议，最终实现前应确认：

1. 是否接受 DirectorPlan 必须人工批准后再进 Assets/Storyboard；
2. Assets 的视觉参考图是否属于必需审批门，还是只审批文字 profile；
3. 首帧是否所有模式都必须人工确认；
4. 自动推进是否先不提供，之后作为项目级 opt-in；
5. 第一集应创建并行 storyboard revision，保留旧 158 条作对比，而不是覆写旧数据。
