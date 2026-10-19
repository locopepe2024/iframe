# 创作词典分层架构 V1

> 符号入口已按用户确认更新：`/` 为词典和 Skill，`@` 为资产检索。当前约定与角色图片 Prompt 实施边界见 `2026-10-19-prompt-dictionary-skill-entry-v3.md`；本文中相反的旧入口描述作为历史记录保留。

日期：2026-10-19。状态：设计契约，待分切片实施。首个接入工位为角色设计台；场景、道具、分镜、3D 导演台沿用同一词典身份与检索模型，各自声明可用动作。本文承接 `2026-10-19-character-design-workbench-system-plan-v1.md` 与 `2026-10-19-martial-arts-director-dictionary-review.md`。

## Observed

- 角色快捷描述词现存于 `frontend/src/lib/avatarFeatureLibrary.ts` 和 `characterQuickActions.ts`：前者以 `face/eye_shape/...` 键分组，后者压平成风格、面容、皮肤、身材体态、服装、发型六类可搜索 `CharacterQuickPreset`。词条有 ID、值和部分来源，但缺统一的语义层、组合关系和媒体案例绑定。
- 平台目录 `PlatformReferenceResource` 已有稳定资源 ID、revision、kind、`category_path`、标签、状态、payload 和来源。后端 `CHARACTER_CATEGORIES` 已列 `character/performance`，但创作台发布入口目前只允许角色分类、`image/video/prompt_preset` 三种 kind；这不等同于完整的结构化词典 API。
- 角色台 `/` 用于动作首层及二级词条选择；`@` 能引用项目媒体和平台角色 Prompt。平台带图案例目前仅插入可编辑文字，图片不会随 Prompt 自动进入模型请求。
- `martial-arts-director-cy` 的词典把体系、招式、可见姿态、动作骨架、影视调性分开。此结构对表演和分镜有价值，不能据此推断它已验证角色脸部一致性。

## Direct implication：分层有两条正交轴

**语义领域**决定词条描述什么、由哪个工位消费；**内容粒度**决定用户拿到的是一个词、一组可编辑方案、效果图，还是一个待执行流程。仅用文件夹路径无法同时表达两条轴。

### 轴 A：语义领域与 owner

| 领域 | 子域示例 | 归属／典型工位 | 不允许的自动投影 |
| --- | --- | --- | --- |
| `character.identity` | 面部轮廓、眉眼、鼻口、肤色肤质、发际线、识别标记、稳定体态 | 项目角色设计 revision | 性格／流派自动决定五官或肤色 |
| `character.look` | 服装版型、材质、配色、妆容、鞋履 | 项目基础造型或本集造型 | 风格卡暗中锁定服装；剧情伤损写入基础身份 |
| `character.performance` | 表情、常态姿态、武术体系、招式、重心、发力、动作节拍 | 项目角色包的表演层与分镜动作任务 | 招式写成永久脸部身份 |
| `prop` | 道具／兵器形态、材质、尺度、持握与运动轨迹 | 独立道具资产及镜头用途 | 因“剑客”身份自动生成武器或绑定某把剑 |
| `scene` | 空间地标、轴线、角度覆盖、主光方向、环境材质 | 场景母版与本集场景派生 | 场景词覆盖项目角色身份 |
| `shot` | 景别、构图、机位、运镜、节奏、转场、动作 keypose | 分镜／导演台当前任务 | 镜头词回写角色基础造型 |
| `world.style` | 题材、画风、材质语言、色彩基线 | 项目美术方向及任务显式覆写 | 未确认风格影响所有工位请求 |

剧本事实、项目角色、场景、道具和媒体变体是**资产／事实**，不是词典条目。词典提供设计候选，选择后只有经用户编辑、保存或确认，才会投影到对应 owner。武术体系词条可以被角色表演任务和分镜任务同时检索，但其来源 revision 相同，应用动作按工位区分。

### 轴 B：内容粒度与用途

| 粒度 | 形态 | 用户动作 | 是否自动进入模型 |
| --- | --- | --- | --- |
| `term` 原子词 | 一个可观察的视觉或动作概念，含释义、同义词和适用槽位 | 预览后插入／替换某字段 | 否；先成为可编辑草稿 |
| `pattern` 组合方案 | 多个词条及有序关系，如“江湖行旅造型”“咏春起势→攻防→收势” | 预览完整组成与冲突，选择整体或部分采用 | 否；展开成可编辑结构 |
| `case` 效果案例 | 经审核的 Prompt、实际媒体、模型参数与人工评价 | 预览；分别选“插入 Prompt”或“引用图” | 否；两种引用独立确认 |
| `template` 任务模板 | 输入槽位、可编辑默认值、输出规格、依赖关系 | 创建当前任务草稿 | 否；默认值必须可见 |
| `skill` 执行流程 | 实际安装、启用且当前工位可调用的能力 | `/` 唤起并审核输入，然后执行 | 用户确认后才调用 |

`skill` 不是词典的媒体资产，也不与 `term` 共用“插入文字”动作。一个 Skill 可以**读取**多个词典层和项目资产，但其执行能力须单独注册。`@` 搜索 `term/pattern/case` 与项目／平台素材；`/` 首层搜索动作或 Skill。点击“词典”按钮和“参考素材”按钮应分别打开同一检索服务的相应筛选，快捷符号不是唯一入口。

## 词条契约与关系

词条建议使用稳定 `dictionary_entry_id + revision`；平台目录资源可作为其发布载体，但 `kind=image|video|prompt_preset` 不能代替 `entry_type`。一条 V1 记录至少包括：

```json
{
  "dictionary_entry_id": "character.performance.wing-chun.chain-punch",
  "revision": 1,
  "semantic_domain": "character.performance",
  "entry_type": "term",
  "category_path": "character/performance/martial/wing-chun",
  "title": "连环冲拳",
  "aliases": ["日字连环冲拳"],
  "definition": "短距离连续直拳的动作概念",
  "visible_cues": ["双拳轮替", "上身正对", "重心稳定"],
  "targets": ["character.pose_library", "shot.action"],
  "status": "candidate",
  "provenance": { "source_repo": "...", "source_commit": "...", "source_path": "...", "license": "..." }
}
```

上例是 **iFrame 建议 schema 的示意**，不是源仓库原生 JSON，也不是当前已发布条目。正式发布还需内容 hash、导入批次、审核人、许可与质量状态。`pattern` 用有序的 `member_entry_id + revision + role` 指向词条；`case` 用稳定媒体变体 ID 指向效果图、保存完整 `prompt_used` 和模型参数；`template` 记录输入槽位和可见默认值。引用使用 ID 和 revision，URL 只用于访问媒体。

不能把“同属一个类别”当作自动依赖。定义显式关系：`is_a` 分类、`compatible_with` 可共同使用、`conflicts_with` 需要提示冲突、`requires` 任务依赖、`illustrated_by` 关联效果案例、`derived_from` 保存来源。`compatible_with` 和 `conflicts_with` 只做提示，用户可改；`requires` 只有在当前任务的真实生成能力要求下才拦截提交，并显示原因。

## 检索与应用合同

检索请求至少带 `station/task/field/project_id/query/source_scope`，返回来源、身份、revision、语义领域、粒度、适用目标、可执行动作、预览状态和许可状态。搜索先按当前字段推荐，再允许切“全部领域”；精确命中不能因推荐排序被隐藏。同名词条按来源和 ID 并列显示。

选择结果分三步：`搜索命中 → 预览定义／组成／效果 → 明确应用动作`。预览不改变草稿；应用后展示实际插入内容和来源；用户修改后保留来源但标“已改写”。最终模型审核重新校验资源仍活跃、revision／变体仍可用，显示实际文本与媒体。下架、失效或权限不足时保留草稿，不按同名结果自动替换。

场景示例：用户在角色姿态任务中搜“咏春”→看体系卡及可见动作词→选择“连环冲拳”插入可编辑姿态要求；到分镜里引用同一已确认角色和道具后，再选择此动作卡作为镜头动作。角色脸型、服装、道具形态、镜头景别都不会被该词条自动改写。

## 现有数据迁移与实施切片

### 实施切片 2A：平台目录显式词典标注

本切片只允许发布者在现有创作台候选提交流程中**显式**标注 `term`（仅文字）或 `case`（带图／视频）。类别映射到 `character.identity`、`character.look`、`character.performance` 或 `world.style`；`character/reference` 不属于词典领域。未标注的历史资源仍是普通参考资源，不能根据 `kind` 或分类自动升级为词条。候选及审核队列保留标注，公共检索只返回已审核 active 项。按 `semantic_domain` 与 `entry_type` 过滤时，未标注资源不匹配。去重 hash 纳入标注，避免不同粒度误合并。

受影响路径：`src/apps/platform_reference_catalog.py`、`src/apps/comic_gen/api.py`、`frontend/src/lib/api.ts`、`frontend/src/components/library/NewLibraryAssetDialog.tsx` 及对应测试。成功条件：非法领域／粒度组合返回 422，旧目录可读，候选不可公开检索，筛选只命中显式标注且 active 的资源，用户提交前看得到标注并可选“普通参考”。本切片不新增 `pattern`，也不把词典条目自动加入模型请求。

### 实施切片 2B：平台词条与组合方案落到角色台

平台 `term` 的可应用文字取已审核资源中用户编辑的 `structured_prompt.content`，不取生成时完整 `prompt_used`；类别明确映射到角色草稿目标字段。没有对应编辑字段的 `character.performance`、`look/palette` 等类别先只在平台库检索，不强行写入身份。选择词条仅修改当前草稿并记录平台资源 ID、revision 和来源，用户可编辑、移除，模型仍需现有审核确认。带图 `case` 仍供 `@` 预览 Prompt；图像是否附加由用户另行选择。

`pattern` 由 2–12 个**已发布**同领域 `term` 的 `{platform_resource_id, revision, role}` 有序引用组成；后端提交时校验有效性，保存固定版本，不依赖未来的同名查找。角色台应用时展开成员的已审文字到可编辑草稿，并显示组合来源；若成员下架或修订不匹配，保持现有草稿并提示不可应用。发布者可在创作台发布窗口选择成员，审核员可看到完整关系。验收：旧资源可读、候选不进入检索、不同领域混用和悬空引用被拒绝、选择组合不会发起模型请求或自动附图。

1. **清点与映射**：给现有 `CharacterQuickPreset` 和 `AVATAR_FEATURE_LIBRARY` 增加迁移映射表，保留原 ID／revision／来源；风格与面容等分别映射语义领域。验收旧草稿 `preset_id` 可读、原文字不变。
2. **词典载体**：扩展平台目录或建立独立词典索引，明确 `entry_type`、`semantic_domain`、关系和来源验证；不要把所有条目塞成 `prompt_preset`。验收候选与已发布隔离、按领域和粒度过滤、同名不合并。
3. **角色台第一批**：面容／皮肤／发型／服装 `term`，古典造型 `pattern`，已审核效果 `case`；姿态任务再接入 3 个武术体系及少量动作词。验收选词只改可编辑草稿、选案例图不自动附图。
4. **分镜与道具**：将动作、兵器、镜头词从同一词典索引按任务筛选；分镜项目资产仍由 `[]` 的类型索引绑定。验收武术词不冒充角色／道具资产，状态与引用可追溯。
5. **Skill 注册**：只有经过当前工位能力验证的武指 Skill 才进 `/`。运行前显示所有词典建议、资产引用和模型输入；输出为候选方案，不自动确认资产。

建议先以当前古典剧的一个角色完成完整闭环，再扩展目录量。词典的首要质量指标是用户能否找到、理解、修改和正确引用条目；条目数量本身不证明创作效率或一致性。

## Not yet proven / What would verify it

- 平台现有文件目录是否适合承载大规模词典、关系和全文索引，需要真实目录规模、查询延迟和并发发布测试；当前仅有角色类别的 API 不证明跨工位可用。
- 外部词条的专业准确性、样例图权利和模型效果需要逐条审核；仓库许可证不能替代媒体来源证明。
- 分层检索是否优于当前平铺分类，需要在古典剧角色与分镜任务中记录定位时间、误选、撤销和最终请求差异。

## 关联资料

- `2026-10-19-character-design-workbench-system-plan-v1.md`：角色台五维实施顺序。
- `../research/2026-10-19-martial-arts-director-dictionary-review.md`：武术词典来源与冲突评估。
- `2026-10-19-ai-workbench-command-context-index-v1.md`：`/`、`@`、`[]` 语义。
- `2026-10-18-platform-shared-asset-library-v1.md`：平台资源身份、来源与审核。
