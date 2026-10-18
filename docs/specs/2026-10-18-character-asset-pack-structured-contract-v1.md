# 角色资产包结构化契约 V1

日期：2026-10-18。状态：分阶段实施；正面全身锚点的项目级确认与版本记录已进入实现，其余资产包类型、本集多状态和分镜状态选择尚未实现。

## 目标与事实边界

角色是一个有版本的视觉身份；一张参考图只是这个身份的一个媒体变体。先定义角色设计、锚点和派生资产之间的稳定关系，再调整工作台输入与平台库。本文参考 [献丑AI 的角色资产包介绍](https://xianchou.com/blog/character-design-asset-pack) 的分类与依赖思路；文章对生成效果的表述属于产品主张，不作为 iFrame 已达到该效果的证据。

**代码事实：** `Character.character_design` 当前是可扩展字典；已有 `identity/look` 草稿、确认 revision、九项可见特征、`reference_assets`。`reference_sheet` 是统一母版媒体容器，`full_body_asset/three_view_asset/headshot_asset` 仍由工作台读取和写入，但模型标为 legacy。`ImageVariant` 已有稳定 `id`、媒体身份、来源引用和提交快照。第一段实现增加了 `Character.asset_pack` 的正面全身锚点历史、CAS 确认接口和工作台确认入口；尚无完整四层资产包、统一的派生类型目录或每个派生物对锚点 revision 的明确绑定。

**直接推论：** 仅新增十个图片按钮或十段提示词，无法表示“哪张锚点生了哪张表情表”、基准变更后的过期关系，也无法在分镜检索时选对角色状态。

## 所有权与身份

| 对象 | 唯一职责 | 稳定身份 |
| --- | --- | --- |
| 项目角色 | 项目中的语义角色和长期可复用视觉设定 | `project_id + character_id` |
| 角色设计 revision | 已审核的身份、造型字段和来源快照 | `character_id + design_revision` |
| 角色资产包 | 围绕角色母版建立的四层通用规范资产 | `project_id + character_id + pack_id + pack_revision` |
| 媒体变体 | 一张原图／生成图或视频的不可变结果 | `variant_id + media_id`，URL 仅供访问 |
| 锚点绑定 revision | 用户认定哪张图作为这版角色的正面全身母版 | `character_id + anchor_revision` |
| 派生任务 | 一次明确目标和输入的生成／上传任务 | `derivative_task_id` |
| 资产包条目 | 一个通用目标类型的候选、选中变体和来源 | `pack_id + kind + entry_id` |
| 剧集角色状态／造型 | 同一角色在本集某些镜头中的确定外观、来源变体、适用镜头和审核状态；一个角色可有多项 | `script_id + character_id + use_id` |
| 剧集角色派生资产 | 仅在本集需要专属造型、状态或媒体时产生的结果 | `script_id + episode_character_asset_id` |

`character_design` 管视觉文字设定；新增项目级 `character_asset_pack` 管通用母版与媒体依赖图；剧集使用绑定记录固定来源和本集覆写，派生资产仅在实际生成或上传新媒体时记录产物。四者不能互相假定已经确认。`digital_avatar` 保持独立的虚拟演员资料，不复制成第二套角色母版 owner。现有 `AssetRevision` 可记录整体资产快照，但不足以代替每张派生图的来源边。

### 多级检索与工作域

检索分为两棵树，不能把项目资产包挂在剧集之下：

```text
项目 project_id
├── 角色 character_id
│   └── 资产包 pack_id / pack_revision
│       └── 层级 layer → 通用资产 kind / entry_id → 变体 variant_id
└── 剧集 script_id
    └── 角色 character_id
        ├── 正常造型 use_id-a → 已确认包内变体
        └── 受伤造型 use_id-b → 本集派生资产 episode_character_asset_id
            └── 本集变体 variant_id
```

**代码事实：** 当前 `Series.characters` 与 `Script.characters` 都使用 `Character` 模型；素材索引把本集条目与系列条目并列展示，并按 ID 去重。这只说明现有存储和视图，不能把“本集角色”解释成已经有明确来源的资产包派生物。新契约需要显式分离这两种角色资产身份。

对于系列项目，当前 `Series.id` 可作为项目容器，带 `series_id` 的 `Script.id` 是剧集；独立项目只有 `Script.id`，实现时仍须用不同的**逻辑类型**区分项目资产包、角色状态／造型和具体产物，不能仅凭同一个物理容器混写。项目角色资产包在剧集工作台可作为来源候选，不能显示成“本集已生成资产”。同一角色在本集可有多个 `use_id`，每项固定 `source_pack_id + source_pack_revision + source_entry_id + source_variant_id + source_design_revision`。正常造型可以直接使用已确认包内变体，不复制媒体；受伤、换装等本集专属状态从来源派生具体资产，保存覆写和生成结果，不回写项目资产包。每个分镜按 `character_id + use_id` 显式选择造型并显示媒体真实的项目或剧集作用域；选择不能只凭镜头编号或人物名称自动推断。

**现有边界：** `episode_person_asset_bindings` 只将导演计划中的 `person_id` 关联到一个当前可见的 `Character.id`；`episode_asset_bindings` 按资产 ID 记录计划适用镜头、选中变体与审核状态；确认的分镜 `reference_package.asset_revision_pins` 固定资产 revision 和媒体变体。它们尚未表达同一角色在本集不同分镜选择不同状态，也未表达角色包 revision 与派生链。人物身份映射仍由现有绑定负责；需增加或关联每个分镜的状态／造型选择，并扩充版本来源，避免建立第二套人物身份 owner。

项目资产包检索支持 `project_id`、`character_id`、`layer`、`kind`、`pack_revision`、`status`；剧集资产检索支持 `script_id`、`character_id`、场景／镜头、状态、来源包版本和本集变体。两者都允许名称和标签搜索，结果返回真实 owner、完整面包屑、确认状态、来源 revision、所选变体 ID 和 WebP 封面身份。缩图 URL 按需续签，不能充当检索键。跨剧集搜索可从项目节点进入，但选择到当前镜头时须再次核对该变体在目标剧集的作用域。

## 角色设计结构

保持现有 V1 的 `identity` 与 `look` 字段：

- `identity`: `face`、`hair`、`skin`、`build`、`recognition_marks`。
- `look`: `clothing`、`palette`、`accessories`、`weapon`。
- 每个字段保存 `value`、`basis`（剧本事实、用户设定、已确认设计、可验证参考或创作选择）和可选的来源引用；空值不能被推断成事实。
- `visual_notes` 只是旧数据兼容和可读摘要，不与上述字段并列成为第二套权威值。结构化字段存在时，提示词投影以字段为准。
- `age_stage`、`route`、角色群体规模等影响设计的参数单独存储。身高数值、惯用手、服装规制未确认时保留未知，不由模型补写为剧本事实。

确认 revision 是不可变快照。编辑先创建草稿；再次确认产生新 revision。它能指导图像任务，但不自动选择或修改锚点图。

## 锚点与资产包 schema 草案

```json
{
  "schema_version": 1,
  "project_id": "series-1",
  "pack_id": "pack-character-1",
  "pack_revision": 3,
  "character_id": "character-1",
  "design_revision": 2,
  "anchor": {
    "anchor_revision": 1,
    "layer": "identity_anchor",
    "role": "front_full_body_neutral",
    "variant_id": "variant-a",
    "media_id": "media-a",
    "confirmation_status": "user_confirmed"
  },
  "entries": [{
    "entry_id": "entry-three-view",
    "layer": "identity_anchor",
    "kind": "turnaround_three_view",
    "status": "candidate",
    "selected_variant_id": null,
    "variants": [{
      "variant_id": "variant-b",
      "media_id": "media-b",
      "source_anchor_revision": 1,
      "source_anchor_variant_id": "variant-a",
      "source_design_revision": 2,
      "reviewed_submission_id": "submission-b",
      "created_by": "generation"
    }]
  }]
}
```

该 JSON 是逻辑契约，不要求原样新增一个可随意写入的字典。实现时使用有界类型、枚举和服务端校验；媒体可继续存现有容器，资产包保存稳定索引，不复制媒体文件或签名 URL。上传图的 `created_by` 为 `upload`，其来源锚点可空，但确认它为标准派生物仍需人工审核。

剧集使用绑定记录固定来源；仅有新媒体时另存派生资产，不能把资产包条目 ID 冒充本集产物。例如：

```json
{
  "use_id": "ep1-character-injured",
  "script_id": "episode-1",
  "character_id": "character-1",
  "purpose": "scene_costume_state",
  "shot_ids": ["shot-after-injury-1", "shot-after-injury-2"],
  "source": {
    "pack_id": "pack-character-1",
    "pack_revision": 3,
    "design_revision": 2,
    "entry_id": "entry-three-view",
    "variant_id": "variant-b"
  },
  "episode_overrides": {"condition": "injured"},
  "selected_media": {
    "scope": "episode",
    "episode_character_asset_id": "ep1-character-injured-look",
    "variant_id": "episode-variant-a"
  },
  "status": "confirmed"
}
```

`episode_overrides` 必须是可审核的有界字段；例子仅表示本集状态，不证明原剧本存在雨景或受伤镜头。无本集派生物时，`selected_media` 应明确指向项目包的真实存储作用域与包内 `variant_id`，并省略 `episode_character_asset_id`；现有系列容器的媒体来源作用域是 `series`，不能把逻辑上的“项目”硬编码为当前 `AssetRevisionPin.source_scope` 的 `project`。实际来源可选资产包锚点或任何已确认包内条目，`entry_id` 在选用锚点时可为空；每次生成记录真实所选来源。适用镜头是显式选择，场景范围仅用于候选筛选，不能代替镜头级选择；若一个镜头内角色状态发生变化，须明确起止状态或拆分镜头，不能用单一静态变体冒充完整变化。审核通过后才成为可供分镜选择的本集角色输入。

转场产生的新场景由场景资产负责其背景和光影；分镜使用该场景资产，并照常选择当前镜头的角色造型 `use_id`。代码中的 `StoryboardFrame.transition_hint` 只描述与下一帧的转场方式，不承担场景生成或角色状态选择。转场不增加独立的状态交接、光影校验或提交步骤；所有镜头都沿用相同的资产选择和提交审核规则。

锚点角色为 `front_full_body_neutral`，要求正面、全身、可见面容、发型、衣装和鞋履。角色已有其他图片时只能作为候选；不得凭容器名推断其满足锚点条件。选定或替换锚点是单独确认动作，记录操作者工作区身份、时间、来源变体和设计 revision。

## 四层资产分类与类型目录

`layer` 是稳定的检索与工作台分组，`kind` 是生成、审核和分镜引用的具体类型。两者均使用有界枚举；不能用图片文件名或提示词猜测所属层级。同一层可以有多个输出规格，某张图片也不能因为被复用就自动变成另一种已确认资产。

| 层级 | 解决的问题 | `kind` / 包含资产 | 必要输入与当前状态 |
| --- | --- | --- | --- |
| 身份锚点层 `identity_anchor` | 这个角色是谁 | `front_full_body_anchor` 正面全身锚点图 | 用户确认设计 revision 与一张符合正面全身要求的变体；现有 `reference_sheet` 可供选择，但不是自动确认 |
| 身份锚点层 | 这个角色是谁 | `turnaround_three_view` 转面三视图 | 锚点；工作台有三视图路径，缺统一来源边 |
| 身份锚点层 | 这个角色是谁 | `turnaround_face_detail` 三视图 + 脸部特写 | 锚点；尚无独立输出类型 |
| 身份锚点层 | 这个角色是谁 | `height_scale` 身高比例对照图 | 锚点；多人时逐一指定其他角色的确认锚点；尚无独立类型 |
| 表演控制层 `performance_control` | 这个角色怎么演 | `expression_sheet` 表情表 | 锚点或确认的面部母版；尚无独立类型 |
| 表演控制层 | 这个角色怎么演 | `pose_sheet` 姿态／体态库 | 锚点、可见动作限制；已有姿态参考容器，未定义资产包任务 |
| 表演控制层 | 这个角色怎么演 | `viseme_sheet` 口型辅音表 | 锚点或确认的面部母版、显式语言与音素集；尚无独立类型 |
| 视觉规范层 `visual_specification` | 这个角色长什么样 | `palette_card` 配色规范卡 | 锚点、确认的配色字段；尚无独立类型 |
| 视觉规范层 | 这个角色长什么样 | `costume_breakdown` 服装拆解图 | 锚点、确认的服装字段；尚无独立类型 |
| 视觉规范层 | 这个角色长什么样 | `prop_standalone` 道具独立图 | 道具资产为媒体 owner；角色资产包只保存持有／使用关系，不能复制成角色图 |
| 环境融合层 `environment_integration` | 这个角色在哪里 | `makeup_scene_still` 妆造定妆照 | 包内可绑定项目级可复用场景与光影 revision；本集场景版本作为剧集具体资产另生；有妆造容器，缺来源边 |
| 环境融合层 | 这个角色在哪里 | `condition_variant` 破损／状态变化图 | 包内为可复用状态规范；本集受伤／雨淋等实际状态另生且标适用场景／镜头；尚无独立类型 |

工作台按这四层呈现资产包，但初次创建只要求身份锚点；其他项由用户按剧情与交付需要选择。表演控制图不写回永久面容字段，环境融合图不写回基础服装或场景基线。`prop_standalone` 在四层目录中可查，但其源媒体与 revision 仍由道具资产管理。

“三视图 + 脸部特写”与“转面三视图”是两个输出规格，不是同一个条目的不同名称。状态图是基础身份的局部覆层，不得改写脸、体型、基础服装或永久识别锚点。配色卡的 HEX 是审核后的规范值；从图片自动采样的值先是候选，不直接写为已确认设定。

## 状态、版本与失效

资产包条目和剧集具体资产各自处于 `missing → candidate → selected → confirmed`，也可标记 `stale` 或 `retired`；它们的确认状态相互独立。`candidate` 说明有结果，不说明质量合格；`selected` 说明工作台选中，不等于确认。资产包任务冻结 `source_anchor_revision`、`source_design_revision`、目标类型、实际媒体引用、结构化参数和用户审过的提示词。剧集任务另外冻结 `source_pack_id/revision`、源条目／变体、本集场景／状态和覆写。重试产生新候选，不覆盖旧变体。

锚点或设计 revision 变化时，旧资产包派生物保持原始引用并显示“基于旧版本”。项目资产包 revision 变化时，已生成的剧集资产同样保持冻结来源；不会自动重生或改写本集结果。它们是否视觉失效需要人工判断，系统只做确定性的版本不匹配提示。已在分镜中引用的旧变体继续有效；替换需由分镜 owner 明确选择并确认。删除母版、派生图、剧集产物或平台资源前检查引用；已引用项先 retire，不能让历史分镜悬空。

## 平台库和提示词投影

平台库分为任务模板、字段片段、带许可的图片／视频参考三种，不混用。当前公开平台参考库的 `resources` 为空；工作台模板只有文字任务分类，不能被呈现为可用脸型或服装图。未来平台资源需有 `resource_id + revision + kind + tags + provenance/license + media_id`；用户选中后先形成项目可解析的绑定或导入，再在角色字段或引用列表中明确应用。

项目角色设计、锚点、资产包条目与本集覆写分别投影到当前任务的可见审核输入。用户可修改后确认；仅被选择并显示的参考图进入模型请求。派生任务即使推荐母版，也必须在提交审核显示该母版，不允许隐藏附加。平台资源升级不改变已有确认 revision，用户可显式 fork 新版本。

## 落地顺序与验证

1. **数据与检索契约：** 分开定义项目角色资产包、剧集使用绑定和可选派生资产的有界模型、真实 owner、两棵检索树、序列化兼容和迁移读取；旧容器仍可浏览，不把旧图自动确认为新锚点或本集产物。优先复用现有 `episode_person_asset_bindings`、`episode_asset_bindings` 和分镜版本锁定。
2. **项目资产包纵切：** 人工选定一张正面全身锚点，基于它生成一张三视图候选；提交审核展示母版与文本；结果保存来源 revision；更换锚点后显示旧版提示。
3. **剧集状态纵切：** 为同一角色确认正常造型和受伤造型两个 `use_id`；前者直接使用包内图，后者派生本集具体资产。两者都冻结包版本、来源变体、覆写和审核状态；两个分镜分别选择状态并显示完整来源。
4. **工作台与检索：** 项目入口浏览角色资产包；剧集入口浏览本集使用绑定、可选派生资产并搜索可用包内来源。候选设计逐项审核，参考图可显式沿用但不自动提交。再增加平台字段和素材检索。
5. **扩类型：** 按需求与模型能力逐项实现表情、配色、服装、状态等；每类有独立质量审核，不承诺一次生成全包。
6. **分镜消费：** 分镜按角色显式选择本集已确认的 `use_id` 及其指定媒体；直接使用项目资产包图时显示项目来源；分镜保留所用 revision 快照。若存在多个可用状态，提交前必须选择，不能静默沿用上一个分镜。场景切换使用新场景资产，不增设分镜转场专用流程。

验收重点：旧数据可读；同名角色与同编号剧集不串库；项目包图不会冒充本集生成资产；本集具体资产可追溯固定的包版本且不回写项目；两棵检索树能定位到正确变体；确认与候选不混淆；换锚点不重写历史；一个派生变体能追溯完整输入；项目外媒体被拒；所有模型输入与实际发送一致；模板不能暗中附加参考图。Blender／3D 导演台不在此契约的验证范围。

实施前需核对的路径：`src/apps/comic_gen/models.py`、`assets.py`、`pipeline.py`、`api.py`，`frontend/src/components/modules/CharacterWorkbench.tsx`，资产索引、分镜引用解析及相应测试。先完成模型和校验测试，再调整 UI。
