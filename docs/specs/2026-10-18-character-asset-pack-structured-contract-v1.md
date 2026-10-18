# 角色资产包结构化契约 V1

日期：2026-10-18。状态：设计规范，尚未实现。

## 目标与事实边界

角色是一个有版本的视觉身份；一张参考图只是这个身份的一个媒体变体。先定义角色设计、锚点和派生资产之间的稳定关系，再调整工作台输入与平台库。本文参考 [献丑AI 的角色资产包介绍](https://xianchou.com/blog/character-design-asset-pack) 的分类与依赖思路；文章对生成效果的表述属于产品主张，不作为 iFrame 已达到该效果的证据。

**代码事实：** `Character.character_design` 当前是可扩展字典；已有 `identity/look` 草稿、确认 revision、九项可见特征、`reference_assets`。`reference_sheet` 是统一母版媒体容器，`full_body_asset/three_view_asset/headshot_asset` 仍由工作台读取和写入，但模型标为 legacy。`ImageVariant` 已有稳定 `id`、媒体身份、来源引用和提交快照。尚无完整角色资产包、统一的派生类型目录或每个派生物对锚点 revision 的明确绑定。

**直接推论：** 仅新增十个图片按钮或十段提示词，无法表示“哪张锚点生了哪张表情表”、基准变更后的过期关系，也无法在分镜检索时选对角色状态。

## 所有权与身份

| 对象 | 唯一职责 | 稳定身份 |
| --- | --- | --- |
| 角色资产 | 当前项目／系列中的语义角色和可见设定 | `scope + container_id + character_id` |
| 角色设计 revision | 已审核的身份、造型字段和来源快照 | `character_id + design_revision` |
| 媒体变体 | 一张原图／生成图或视频的不可变结果 | `variant_id + media_id`，URL 仅供访问 |
| 锚点绑定 revision | 用户认定哪张图作为这版角色的正面全身母版 | `character_id + anchor_revision` |
| 派生任务 | 一次明确目标和输入的生成／上传任务 | `derivative_task_id` |
| 派生资产条目 | 一个目标类型的候选、选中变体和来源 | `character_id + kind + entry_id` |

`character_design` 管视觉文字设定；新增 `character_asset_pack` 管媒体依赖图。两者不能互相假定已经确认。`digital_avatar` 保持独立的虚拟演员资料，不复制成第二套角色母版 owner。现有 `AssetRevision` 可记录整体资产快照，但不足以代替每张派生图的来源边；资产包必须记录自己的版本和引用。

### 多级检索与工作域

用户导航路径为 **项目／系列 → 剧集 → 角色 → 四层分类 → 资产类型 → 变体**。在当前代码中，`Series.id` 是系列级容器，剧集是带 `series_id` 和 `episode_number` 的 `Script.id`；独立项目只有 `Script.id`，没有系列节点。界面可称“项目 → 剧集”，但持久化身份必须保存真实 `series_id`、`script_id` 和 owner 范围，不能按标题或集数反查。

```text
项目／系列 series_id
└── 剧集 script_id
    └── 角色 character_id
        └── 层级 layer（身份锚点／表演控制／视觉规范／环境融合）
            └── 资产 kind / entry_id
                └── 变体 variant_id
```

这是浏览路径，不是每层都复制一份媒体。系列共享角色在剧集中作为继承项可见，仍由 `source_scope=series + source_container_id=series_id` 持有；剧集专属角色由其 `script_id` 持有。若用户把共享角色改为本集造型或状态，显式建立本集 revision／fork，记录 `source_character_id + source_design_revision + source_anchor_revision`，不回写系列母版。独立项目直接从 `script_id` 进入角色；平台素材先经明确导入或绑定，不能伪装成本集资产。

检索 API 至少支持 `series_id`、`script_id`、`character_id`、`layer`、`kind`、`status`、`source_scope` 的逐级过滤，并允许在角色节点内按标签／名称搜索。结果返回面包屑、真实 owner、继承／本集标记、确认状态、设计及锚点 revision、所选变体 ID 和 WebP 封面身份。缩图 URL 是按需续签的展示字段，不能充当检索键。跨剧集搜索可从系列节点进入，但选择到当前镜头时须再次核对该变体在目标剧集的可用作用域。

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
| 环境融合层 `environment_integration` | 这个角色在哪里 | `makeup_scene_still` 妆造定妆照 | 锚点、当前场景与光影 revision；有妆造容器，缺场景来源边 |
| 环境融合层 | 这个角色在哪里 | `condition_variant` 破损／状态变化图 | 锚点、显式状态与适用集／镜头范围；尚无独立类型 |

工作台按这四层呈现资产包，但初次创建只要求身份锚点；其他项由用户按剧情与交付需要选择。表演控制图不写回永久面容字段，环境融合图不写回基础服装或场景基线。`prop_standalone` 在四层目录中可查，但其源媒体与 revision 仍由道具资产管理。

“三视图 + 脸部特写”与“转面三视图”是两个输出规格，不是同一个条目的不同名称。状态图是基础身份的局部覆层，不得改写脸、体型、基础服装或永久识别锚点。配色卡的 HEX 是审核后的规范值；从图片自动采样的值先是候选，不直接写为已确认设定。

## 状态、版本与失效

派生条目可处于 `missing → candidate → selected → confirmed`，也可标记 `stale` 或 `retired`。`candidate` 说明有结果，不说明质量合格；`selected` 说明工作台选中，不等于项目确认。一次任务冻结 `source_anchor_revision`、`source_design_revision`、目标类型、实际媒体引用、结构化参数和用户审过的提示词。任务重试产生新候选，不覆盖旧变体。

锚点或设计 revision 变化时，旧派生物保持原始引用并显示“基于旧版本”。它们是否视觉失效需要人工判断，系统只做确定性的版本不匹配提示。已在分镜中引用的旧变体继续有效；替换需由分镜 owner 明确选择并确认。删除母版、派生图或平台资源前检查引用；已引用项先 retire，不能让历史分镜悬空。

## 平台库和提示词投影

平台库分为任务模板、字段片段、带许可的图片／视频参考三种，不混用。当前公开平台参考库的 `resources` 为空；工作台模板只有文字任务分类，不能被呈现为可用脸型或服装图。未来平台资源需有 `resource_id + revision + kind + tags + provenance/license + media_id`；用户选中后先形成项目可解析的绑定或导入，再在角色字段或引用列表中明确应用。

角色设计、锚点和派生条目分别投影到当前任务的可见审核输入。用户可修改后确认；仅被选择并显示的参考图进入模型请求。派生任务即使推荐母版，也必须在提交审核显示该母版，不允许隐藏附加。平台资源升级不改变已有确认 revision，用户可显式 fork 新版本。

## 落地顺序与验证

1. **数据与检索契约：** 定义有界模型、系列／剧集真实 owner、多级索引、序列化兼容和迁移读取；旧容器仍可浏览，不把旧图自动确认为新锚点。
2. **最小纵切：** 人工选定一张正面全身锚点，基于它生成一张三视图候选；提交审核展示母版与文本；结果保存来源 revision；更换锚点后显示旧版提示。
3. **工作台：** 基于 schema 收起可选输入，候选设计逐项审核，参考图一键沿用但不自动提交。再增加平台字段和素材检索。
4. **扩类型：** 按需求与模型能力逐项实现表情、配色、服装、状态等；每类有独立质量审核，不承诺一次生成全包。
5. **分镜消费：** 只引用用户确认的角色设计和指定变体／状态；分镜保留所用 revision 快照。

验收重点：旧数据可读；同名角色与同编号剧集不串库；系列继承项显示真实 owner；本集 fork 不回写系列；层级与类型过滤能定位到正确变体；确认与候选不混淆；换锚点不重写历史；一个派生变体能追溯完整输入；项目外媒体被拒；所有模型输入与实际发送一致；模板不能暗中附加参考图。Blender／3D 导演台不在此契约的验证范围。

实施前需核对的路径：`src/apps/comic_gen/models.py`、`assets.py`、`pipeline.py`、`api.py`，`frontend/src/components/modules/CharacterWorkbench.tsx`，资产索引、分镜引用解析及相应测试。先完成模型和校验测试，再调整 UI。
