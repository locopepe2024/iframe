# LumenX Creative Production System Canonical Spec v1

状态：当前创意生产链的 canonical 设计入口
日期：2026-10-04
适用：iframe Studio 的剧本、系列/分集、资产、图片编辑、3D 导演台、Storyboard、Motion 和项目管理

## 1. 目标

建立一条可审阅、可修订、可追溯的创作链：

```text
剧本导入
  → 分集与事实提取
  → 全剧/分集导演理解
  → 导演拍摄计划
  → 分集视觉变体
  → Storyboard
  → Motion / 视频生成
  → 装配与交付
```

贯穿这条链的两个辅助系统是：

```text
Asset Management：资产身份、版本、引用和来源
Asset Design：图片编辑、Avatar、3D 导演台和视觉候选制作
```

它们必须分开。资产管理保存和组织结果；资产设计生产和修改结果。

## 1.1 三层系统架构

整个系统还应按“管理、执行技能、能力”三层组织。三层不是三个页面，而是三个不同的责任边界：

```text
管理层（全模态、长程、版本和资源）
  → 执行层（Skills：把创作意图转成结构化计划）
  → 能力层（Tools/Models：执行图像、3D、音频和视频操作）
  → 管理层登记候选、版本、任务和结果
```

### 管理层：全模态长程管理

管理层负责跨模态、跨阶段和跨项目的持久状态：

- 全局资产、系列/分集/场景资产和引用关系；
- 角色图、场景图、道具图、motion reference、音频和视频媒体索引；
- 资产生成任务、图片编辑任务、3D 快照、Motion 任务和剪辑任务的状态；
- `asset_id`、`variant_id`、`media_id`、revision、lineage、来源和 owner；
- 项目、系列、分集、场景、镜头和当前工作区上下文；
- 草稿、确认版本、历史版本、任务恢复、删除、复制和冲突提示；
- 跨模态结果的检索、引用、权限和可追溯性。

管理层不决定“这一场应该怎样拍”，也不直接生成图片或视频。它接收执行层的结构化请求，调用能力层任务，并保存返回的候选与审核状态。

### 执行层：Skills 技能编排

Skills 将剧本、导演约束和用户意图转换成可执行的结构化产物：

- 剧本分析和事实抽取；
- 全剧/分集导演理解；
- 剧集生成和长上下文一致性；
- 场景拆分、beat/shot 规划和拍摄计划；
- 角色身份、造型、连续性和表演约束；
- 风格、运镜、构图、光影和特效意图；
- blocking、动作、表情、声音和剪辑结构；
- Storyboard 与 Motion 的输入编排和结果审阅。

Skill 的输出应是可审阅的 JSON/计划/约束/候选，不应把完整模型 prompt 当作唯一事实。Skill 可以调用一个或多个能力，但不能绕过管理层直接写入最终资产。

“导演技能”“角色技能”“特效技能”属于这一层。它们不是某个单一模型，而是领域规则、上下文投影、提示词构建、候选评估和用户审阅流程的组合。

### 能力层：Tools / Models

能力层是可替换的执行工具或模型适配器：

- 图片生成和图片编辑；
- Avatar 角色素材服务；
- 3D 导演台、场景 blockout、全景、深度、机位和白模预演；
- Motion capture、motion-track、动作重定向和动作视频生成；
- 视频生成、视频编辑和特效合成；
- 音频生成、声音设计、ASR、TTS、Lip Sync 和混音；
- 剪辑、转场、字幕、编码和 QC。

能力层只执行明确的结构化请求，返回候选媒体和运行元数据。它不应自行解释整部剧、修改 Director 理解或写入全局资产。

### 三层交互规则

```text
管理层提供当前 revision 和权限
  → Skill 读取上下文并生成执行请求
  → 能力层执行并返回候选/任务
  → 管理层保存结果和 lineage
  → 用户在 Skill/工作台中接受、修改或删除
```

同一个能力可以被多个 Skill 使用；同一个 Skill 也可以编排多个能力。例如：

- 角色技能调用 Avatar 服务和图片编辑生成定妆候选；
- 场景技能调用 3D 导演台和图片生成生成场景参考；
- 导演运镜技能调用 3D 机位预演和 Motion 生成；
- 剪辑技能调用视频、音频、字幕和编码能力。

管理、Skill 和能力都必须记录自己的 revision 和输入输出来源，不能用“模型成功返回”替代用户确认或资产入库。

## 2. 产品事实边界

### 2.1 剧本和导演

剧本保存原文事实、来源范围、对白、场景和事件。导演理解解释主题、人物关系、时间线、风格和观众感受。拍摄计划把这些理解落成场景、节拍、镜头、人物、道具、空间和连续性绑定。

导演/编剧负责定义：

- 这一场需要什么角色、场景和道具；
- 为什么需要；
- 时间、地点、季节、风格和戏剧重点；
- 运镜、光影、表演、动作、表情和特效意图；
- 需要保持的连续性。

他们不必直接制作每张最终图片。制作人员和工具负责把要求制作成可审核候选，用户拥有最终接受、修改和删除权。

### 2.2 Assets

Assets 保存角色、场景、道具及其变体。它不决定镜头数量、切镜、站位或完整表演。

资产层级：

```text
Level 0  全局底座：角色照/场景底座/道具多视图
Level 1  系列或分集视觉变体：定妆、阶段、季节、服装、场景状态
Level 2  场景或镜头状态：剧情剧照、表情、动作前后状态、道具状态
```

角色的稳定身份由 `person_id + identity_revision` 表示；时代和分集外观由 `era_variant_id + look_revision` 表示；场景和镜头状态由视觉变体和 `scene_context_revision` 表示。

一次生成的分集视觉变体可以被多个场景和镜头引用。只有视觉约束变化时才创建新变体。

### 2.3 Storyboard

Storyboard 是离散的镜头计划和关键画面层，回答：

> 这一镜头要让观众看到什么，以及画面如何构成？

它包含 scene/beat/shot 来源、视觉变体、景别、机位、构图、blocking、光影、对白、声音和导演效果。一个确认的 shot 对应一个 Storyboard frame，不重新拆分或解释拍摄计划。

### 2.4 Motion

Motion 是时间变化和表演执行层，回答：

> 这一镜头中的人物、镜头和环境如何随时间变化？

它包含人物轨迹、动作速度、表情曲线、摄像机运动、布料/道具反应、口型和节奏。Motion 可以是 3D 白模预演、动作参考视频、motion-track 或视频生成候选，但不是自动成片。

资产里的 `asset_motion_reference` 是可复用的基础动态证据，例如自然走路、转身或布料反应；Shot Motion 是绑定到具体 shot 的时间方案。资产动态参考不能自动覆盖已确认的 Shot Motion。

## 3. 分层数据模型

### 3.1 全局/外部资产

全局资产是可复用底座，不携带某一集的剧情事实：

- 角色：至少支持正脸、侧脸、半身/面部、全身或三视图等 4 个基础变体；
- 场景：主视角、侧/反向、远景关系、材质细节；
- 道具：主视角、侧/背面、使用状态、材质细节；
- 每个变体都有 `variant_id`、职责、来源、审核状态和 lineage。

角色 Avatar 的身份、参考图、候选版本、声音和动作资产由 Avatar 服务负责。iframe 通过 `AvatarCharacterAssetClient` 使用 `character_id + identity_revision + look_revision`，不把本地图片副本作为权威身份。

### 3.2 系列与分集

系列提供跨集的导演约束、共享资产引用和全局故事上下文。分集提供本集实体引用、分集视觉变体和场景/镜头引用。

分集资产不是导入时就完成的最终设计。导入阶段可以建立实体和底座引用；拍摄计划确认后，才生成场景相关变体。

### 3.3 分集视觉变体索引

分集使用一个统一索引，不拆成互斥的“定妆库”和“场景剧照库”。每个条目至少包含：

```json
{
  "variant_id": "...",
  "parent_asset_id": "...",
  "level": 1,
  "scope": "episode",
  "look_role": "大学时期冬季校园",
  "scene_refs": ["scene-09-library"],
  "shot_refs": [],
  "identity_revision": 3,
  "look_revision": 2,
  "scene_context_revision": 1,
  "review_status": "accepted"
}
```

### 3.4 EpisodeVisualContext

Assets 生成不应自行读取完整 Director JSON。服务端从已确认来源投影出 `EpisodeVisualContext`：

- `script_revision`；
- `director_interpretation_revision`；
- `shooting_plan_revision`；
- character bindings：人物、时代、造型、连续性锁；
- scene bindings：地点、内外景、时段、季节、天气、场景资产；
- prop bindings：关键道具、携带者、出现/缺席和状态；
- shot bindings：表演、构图、灯光、blocking 和镜头来源。

该投影只包含可执行视觉约束，不包含事实账本、故事地图或 Director 内部元数据全文。

## 4. 阶段和输入输出

### Stage 0：项目管理

项目管理负责系列、分集、版本、所有者、删除/复制/重命名、当前阶段和任务状态。项目管理不拥有剧本事实、资产内容或视频生成逻辑，只保存引用和状态。

每个项目必须能恢复：

- 当前系列和分集；
- 当前 Script/Director/Shooting Plan/Storyboard/Motion revision；
- 当前选中资产、镜头和任务；
- 未保存草稿和冲突原因。

旧项目、空项目和历史版本必须可见、可重命名、复制和删除。刷新不能回退到历史 branch 或丢失当前 revision。

### Stage 1：剧本导入与分集

输入：原始剧本和补充资料。

输出：原文、来源范围、分集、候选角色/场景/道具和事实提取。

此阶段不生成场景级剧照，不把梗概中的后续剧情自动写入当前分集事实。

### Stage 2：导演理解

输入：剧本、全剧资料、事实账本、长文摘要和分集原文。

输出：全剧或分集 DirectorInterpretation，包含主题、人物关系、时间地点、风格、场景线、剧情线、视觉和表演原则。

分析结果与入库解耦。模型返回的未知人物、关系或状态应作为待审阅候选，不因本地严格字段失败而丢弃完整分析结果。

### Stage 3：拍摄计划

输入：已确认 DirectorInterpretation。

输出：`scene_plan → beat_plan → shot_plan`：

- production scene、时间、地点、季节、天气；
- 出场人物、阶段和造型需求；
- 关键道具和状态；
- 出场顺序、座位、站位、朝向和 blocking；
- 景别、机位、构图、运镜、光影、表演和声音；
- scene/beat/shot IDs 和 revision/hash。

拍摄计划是从导演理解进入视觉资产生产的关键阶段。计划确认前，Assets 只建立实体和底座引用；确认后才能执行分集视觉变体同步。

### Stage 4：分集视觉资产

输入：确认的 Shooting Plan、EpisodeVisualContext、全局底座和用户参考图。

输出：定妆/阶段变体、场景剧情变体、关键道具状态图和审核状态。

同步是增量的：匹配已有变体则复用，缺失才创建任务；计划变化输出新增/变更/失效绑定，由用户决定是否重新生成。

### Stage 5：Storyboard

输入：确认 shot plan、分集视觉变体、可选 3D snapshot、用户 prompt。

输出：一 shot 一 frame 的可编辑镜头描述和关键画面候选。

Storyboard 可以引用 Assets 和 3D 参考，但不能重新决定角色身份、镜头数量或拍摄计划。

### Stage 6：Motion

输入：确认 Storyboard frame、asset motion reference、3D blocking、用户动作/运镜要求。

输出：Shot Motion reference、白模视频、motion-track 或视频生成任务。

Motion 不能重新决定场景、角色身份、景别或镜头数量。需要改变这些内容时回到 Director/Shooting Plan/Storyboard。

### Stage 7：装配

输入：用户选择的画面、Motion 输出、独立音频和字幕轨。

输出：AssemblyRun、成片、字幕 sidecar 和 QC 结果。视频返回不等于装配完成。

## 5. 资产设计入口

### 5.1 图片编辑

图片编辑是通用的视觉候选制作工具：

- 从全局底座创建多视图或基础变体；
- 从分集变体创建场景剧情变体；
- 局部修复、服装替换、妆容、表情和细节调整；
- 保存为底座变体、分集变体或场景变体；
- 原图保留，候选可接受、继续编辑或删除。

图片编辑不修改 Director、Shooting Plan 或角色永久身份。

### 5.2 3D 导演台

3D 导演台负责空间和时间参考：

- 场景 blockout、全景和深度；
- 预置机位、镜头语言和画幅；
- 人物/道具占位、站位、朝向和路径；
- 白模视频和 motion-track；
- 3D scene snapshot 和 camera snapshot。

3D 导演台只读取已确认角色 `character_id + identity_revision + look_revision`，不成为 Avatar 身份库，也不把本地图片副本作为权威身份。

### 5.3 Avatar 角色工作台

Avatar 工作台负责真人角色身份、基础外观、造型变体、连续性锁和 Avatar 资产版本。iframe 只负责展示、选择、生成请求投影和引用版本。

### 5.4 资产库

资产库是管理入口，不是唯一创作入口。它负责浏览、筛选、导入、导出、重命名、删除、变体选择、来源和 lineage。资产库中的“创建变体”应进入图片编辑或对应设计工具；不能把项目级生成接口伪装成全局底座设计。

## 6. 3D、Storyboard、Motion 的后续汇合契约

本节是能力成熟后的下一阶段设计，不是当前实现入口。当前版本不要求 3D 导演台和导演管理层互相传递以下版本化引用；过早引入这些字段会在能力尚未稳定时制造第二套事实源和版本漂移。

一个可生成镜头至少引用：

```json
{
  "shot_id": "shot-01",
  "asset_bindings": [
    {"asset_id": "char-shen-xia", "variant_id": "look-winter", "role": "character"}
  ],
  "storyboard_frame_id": "frame-01",
  "scene_snapshot_id": "scene-snapshot-01",
  "camera_preset_id": "camera-medium-follow",
  "blocking_revision": 2,
  "motion_reference_ids": ["motion-walk-01"],
  "spatial_review": "confirmed"
}
```

缺少 3D 参考时可以使用结构化 blocking，但必须标记 `spatial_review: pending`。缺少场景视觉变体时可以保存 Storyboard 草稿，但必须显示缺失项。

## 7. 版本和依赖规则

下游只能引用上游已确认 revision：

```text
Script
  → DirectorInterpretation
  → DirectorShootingPlan
  → EpisodeVisualContext / Assets
  → Storyboard
  → Motion
  → Assembly
```

上游变更使下游标记 stale，但不自动删除用户结果。下游变更不使上游失效：修改风格、Motion 或场景视觉变体不应强制重新计算 Director 理解或拍摄计划，除非用户明确选择重新绑定。

所有生成结果都保存：

- 来源 revision/hash；
- asset/variant IDs；
- 场景/镜头 IDs；
- 模型、prompt 和参数；
- 用户审核状态；
- 父结果和 lineage。

## 8. 历史文档关系

以下文档继续保留为专项细节，但本文件是跨模块总入口：

| 文档 | 关系 |
| --- | --- |
| `2026-09-25-script-director-assets-storyboard-motion-workflow-v1.md` | 阶段边界和 Director→Storyboard→Motion 旧总 spec；本文件补充资产设计、3D 和项目管理，并取代其总流程表述。 |
| `2026-09-26-director-shooting-plan-v1.md` | 拍摄计划数据结构和确认契约；继续有效。 |
| `2026-09-26-director-plan-storyboard-handoff-v1.md` | 确认计划到 Storyboard 的确定性 apply；继续有效。 |
| `2026-10-04-asset-library-foundation-and-production-variant-v1.md` | 底座、分集视觉变体和同步细节；继续有效，本文件提供总层级。 |
| `2026-10-04-shooting-plan-storyboard-and-director3d-roadmap-v1.md` | 当前下一阶段路线和 3D 汇合；继续有效。 |
| `2026-10-06-style-assets-shot-template-roadmap-v1.md` | 已确认拍摄计划之后的风格扩展、Assets 生产与分镜模板实施顺序；作为下一阶段专项计划。 |
| `2026-10-03-digital-avatar-character-design-board-v1.md` | Avatar 外部权威、角色工作台和 3D 引用边界；继续有效。 |
| `2026-09-19-character-local-image-edit-v1.md` | 图片编辑专项 slice；仅描述入口实现，不代表完整资产设计职责。 |
| `2026-09-19-iframe-3d-director-browser-core-v1.md` | 3D 浏览器导演台 V1；明确本地草稿边界，继续有效。 |
| `2026-09-23-director-local-white-model-animation-import-v1.md` | 白模动画导入；属于 Motion/3D 专项，不取代 Shot Motion 契约。 |
| `2026-09-18-material-to-asset-import-v1.md` | 媒体导入为语义资产的身份规则；继续有效。 |
| `integrated-creative-workspace-v1.md` | 项目工作区、模式切换和共享上下文；本文件补充创作阶段依赖。 |

历史文档不因本文件创建而删除。若专项文档与本文件发生冲突，以本文件的层级、职责、版本和来源规则为准；专项文档需要在下一次修改时补充 `Canonical reference` 链接。

## 9. 当前代码事实与未完成项

已存在或已部分实现：

- Script/Director/Shooting Plan 独立 revision 和确认流程；
- Shooting Plan scene/beat/shot 结构和场景资产绑定；
- Storyboard plan-to-frame handoff 契约；
- 资产库角色、场景、道具和变体索引；
- 图片编辑入口和 3D 导演台浏览器核心；
- 3D motion-track、局部 quaternion、IK、清理和 bundle 契约；
- H3/视频结果和媒体资产引用。

仍需实现或验证：

- EpisodeVisualContext 从确认拍摄计划到分集 Assets 的服务端投影；
- 分集视觉变体的场景/镜头适用范围和增量同步 UI；
- 图片编辑生成结果写入正确 Level 和 scope；
- 3D scene snapshot、camera preset、panorama、depth 和 blocking 导入 Storyboard；
- asset motion reference 与 shot Motion 的独立存储和选择；
- 分镜参考图/3D snapshot/动作参考的统一引用契约；
- 旧版混合分集 Assets 的迁移审阅，不根据图片内容自动猜测层级；
- 项目管理对所有 revision、任务和历史版本的恢复、删除、复制和冲突提示。

## 10. 实施顺序和验收

1. **能力独立验收**：图片编辑和 3D 导演台先在各自工作区完成可用能力，不接入对方版本化数据。
2. 固化图片编辑、3D 导演台和 Motion 的本地/模块内输入输出边界。
3. 固化 canonical types、revision lineage 和 `EpisodeVisualContext`。
4. 完成确认 Shooting Plan → 分集 Assets 增量同步。
5. 完成 Assets → Storyboard 的视觉变体选择和缺失项提示。
6. 完成 Storyboard → Motion 的独立动作/运镜参考契约。
7. 能力稳定后，再实现 3D scene snapshot、camera preset、blocking 和 panorama/depth 的跨工作流引用。
8. 完成图片编辑、Avatar、3D 导演台的导入和来源回溯。
9. 完成项目工作区的跨模式上下文、版本恢复和真实部署 commit 核验。

最低验收标准：

- 用户能从剧本导入走到已确认拍摄计划；
- 拍摄计划同步只产生本集实际需要的资产绑定和缺失任务；
- 同一视觉变体可被多个场景和镜头引用；
- Storyboard 能同时看到资产、blocking 和可选 3D 参考；
- Motion 不重新决定 Storyboard 的镜头结构；
- 全局身份、分集造型、场景状态、Motion 和成片可以分别修订；
- 任一结果都能追溯到来源 revision、asset/variant、scene/shot 和生成任务；
- 用户可接受、继续编辑或删除 AI 候选，不被模型结果强制覆盖。

验证范围：目标文件级单元测试、工作流 API 测试、前端 typecheck、生产 build、3D 导演台专项测试、部署后真实 commit/静态资源/API 核验。浏览器自动化和本地 3D 视觉验收需在用户明确授权相应本地 URL 后执行。

## 11. 并行任务拆分与责任边界

后续实现拆成两个独立工作流。第一阶段两条工作流完全独立；能力通过独立页面和本地/模块内状态验收后，才设计跨工作流版本化交汇。两条工作流都基于当前发布基线开发，不整树互相合并，不改变对方的事实源。

### Workstream A：3D 导演台与视觉制作能力

负责：3D 导演台团队/模块。

范围：

- 图片编辑入口和局部视觉编辑能力；
- 场景 blockout、场景预置、全景和深度参考；
- 预置机位、焦段、画幅、景别和镜头语言；
- 人物/道具占位、站位、朝向、路径和屏幕方向；
- 运镜预演、白模视频、motion-track 和动作参考；
- 3D scene snapshot、camera snapshot、blocking revision；
- 将视觉和空间候选导出为可被 Storyboard 引用的媒体/快照。

不负责：

- 全剧或分集导演理解；
- 剧本事实和人物关系账本；
- 场景/beat/shot 的剧情拆分；
- 全局/分集资产的长期管理；
- 修改 DirectorInterpretation、DirectorShootingPlan 或 Storyboard 的确认版本；
- 把本地图片副本变成 Avatar 身份权威。

### Workstream B：导演理解与剧集过程管理

负责：管理层和 Director/Assets/Storyboard 工作流。

范围：

- 剧本导入、分集、原文来源和事实提取；
- 全剧导演理解和分集导演理解；
- 人物关系、时间线、场景线、剧情线和全剧一致性；
- 拍摄计划的 scene/beat/shot 拆分和确认；
- 从已确认拍摄计划生成 `EpisodeVisualContext`；
- 分集视觉变体同步、适用场景和角色继承；
- Storyboard 的 shot 绑定、视觉变体选择和缺失项提示；
- 项目/系列/分集版本、任务状态、历史恢复、复制、删除和冲突管理；
- 用户接受、继续编辑、删除和重新绑定 AI 候选。

不负责：

- 3D 网格、骨骼、相机渲染或白模动画实现；
- 具体图片编辑算法和 Motion provider 适配；
- 把 3D 导演台内部状态复制成另一套项目或资产数据库；
- 静默修改 3D 场景、机位或用户已确认的空间快照。

### 后续交汇接口（暂不实现）

在图片编辑和 3D 导演台能力完成独立验收前，不建立强制的跨工作流交汇接口。当前允许：

- 3D 导演台使用自己的本地草稿和示例数据；
- 图片编辑独立读取用户选择的图片并输出候选；
- 导演管理层继续独立完成剧本、导演理解、拍摄计划和剧集一致性；
- Storyboard 暂时使用已有资产引用和结构化 blocking，不依赖 3D snapshot。

能力验收完成、数据边界稳定后，才启用以下交汇接口：

Workstream A 向 Workstream B 提供只读、版本化的：

- `scene_snapshot_id + scene_snapshot_revision`；
- `camera_preset_id + camera_preset_revision`；
- `blocking_revision`；
- panorama/depth media IDs；
- motion reference IDs 和 preview metadata；
- 资产引用的 `asset_id + variant_id`，不提供本地副本作为身份依据。

Workstream B 向 Workstream A 提供只读、版本化的：

- `scene_id`、`beat_id`、`shot_id`；
- 场景地点、时间、季节、天气和布置约束；
- 人物 `person_id`、`era_variant_id`、`look_revision`；
- 关键道具及其状态；
- shot 的构图、景别、表演和导演效果；
- 当前允许引用的 `EpisodeVisualContext` revision。

任何一方的版本发生变化，另一方只标记引用 stale 并提示用户重新绑定；不得自动覆盖对方的草稿或确认结果。

### 发布与验收规则

1. 两条工作流分别测试、构建和记录 commit。
2. 组合发布只允许目标文件和已声明的交汇契约进入，不整分支合并长期漂移内容。
3. 发布前检查真实运行分支、后端镜像、前端静态资源 commit 和接口路径。
4. 3D 能力可以先独立发布为可选 Storyboard reference，不阻塞导演理解和普通分镜流程。
5. 管理层可以在没有 3D 快照时保存分镜草稿，但必须显示 `spatial_review: pending`。
