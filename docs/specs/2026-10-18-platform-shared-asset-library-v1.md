# 平台共享资产库与设计包规范 V1

## 目标

为 iFrame 增加一个可由所有用户读取的“共享”资产目录，承载平台级的风格、题材、运镜、特效、角色库和可复用视觉设计包。共享目录提供可检索的结构化参考，不直接向用户项目或模型请求隐式注入提示词。

该规范参考本地 `git project/open-ai-canvas` 的资产角色、工作流和资源访问边界。其参考库内容可以直接导入 iFrame 的共享目录，但必须保留版权、许可证和来源信息；不得把“已导入”解释成“无条件可商用”。当前阶段先确定数据与权限边界，再分批接入种子数据和 UI。

## 证据与未决事项

### 已确认的 open-ai-canvas 代码事实

- `StoryboardAssetRole` 已区分 `character`、`environment`、`wardrobe`、`prop`、`weapon`、`style`、`motion`、`audio`。
- `CanvasWorkflowKind` 已提供 `character`、`scene`、`storyboard`、`shot`、`styleboard`、`reference_set`、`reference_video`、`action_board` 等工作流类型。
- 角色数据可绑定资产 ID、版本 ID、角色定义和视觉状态；风格数据可绑定 `stylePresetId`、结构化风格档案和执行计划。
- 工作台种子包含风格迁移参考、镜头运动测试、短剧角色/场景/分镜模板及视频参考条目。
- 资源访问按展示、复制、下载、浏览器处理、模型输入区分用途，并返回稳定资源身份、实际变体、过期时间和 revision。
- 前端资产状态包含 `draft`、`review`、`confirmed`、`archived`，并按用户 scope 保存。
- 仓库包含根目录 `LICENSE`、`NOTICE`，风格库另有 `THIRD-PARTY-LICENSES.md`；工作台种子对 Unsplash 和 MDN CC0 示例有来源披露字段。

### iFrame 当前已知事实

- iFrame 已有用户隔离的资产、项目/剧集资产和全局候选引用逻辑。
- 场景图片变体、视觉设计快照、分镜视觉预设已经保存结构化参数和来源 revision。
- 设计工具生成的结果必须经过显式选择、导入或复制后才能成为项目或剧集资产。

### 尚未证明或需要后续验证

- open-ai-canvas 的全部内置条目是否都有相同的可迁移版权、来源和生产授权；必须按条目读取许可证，而不能按仓库整体许可证推断。
- iFrame 生产环境是否已有适合长期保存平台共享媒体的独立存储和稳定媒体身份。
- 共享资产是否需要管理员审核工作流；本规范先按“平台发布后只读”处理，不假设已有管理员后台。

## 目录与作用域

用户界面显示四个逻辑目录：

| 目录 | 可见范围 | 写入方式 | 典型内容 |
|---|---|---|---|
| 全部 | 所有可访问的共享、项目、剧集和个人资产 | 不直接写入 | 聚合检索结果 |
| 共享 | 所有 iFrame 用户只读 | 平台种子或受控发布 | 风格、题材、运镜、特效、角色库、公共参考集 |
| 项目/剧集 | 当前用户有权访问的项目或剧集 | 用户显式创建或导入 | 当前作品的角色、场景、道具、分镜参考 |
| 个人 | 当前用户私有 | 当前用户显式创建 | 私有设计包、未发布变体、个人参考 |

共享资产的逻辑 scope 使用 `platform_shared`。不能把共享资产伪装成某个用户或项目的 owner 资产，也不能依赖前端过滤来实现权限。

## 无注册体系下的平台资源身份

iFrame 当前没有独立的用户注册和管理员账户体系，因此平台资源不绑定到某个用户或 API Key，而绑定到部署实例：

```text
platform_instance
  └─ platform_shared resources

api_key → owner_profile_id
  └─ project / series / episode / private assets
```

规则：

- `platform_shared` 是部署级只读目录，所有有效 API Key 可以读取和检索。
- API Key 身份只用于工作区隔离、项目写权限和媒体访问，不拥有平台资源所有权。
- 用户可以把平台资源绑定到自己的项目，或显式 fork 成项目/剧集/个人资产。
- 平台资源不能由普通 API 请求直接创建、修改或删除。
- 平台资源通过受控导入、部署配置或未来独立的管理员能力发布。
- 当前 `global` 仍表示工作区级共享资产，不能把它当作部署级平台资源。

建议的部署资源目录：

```text
config/platform_reference_catalog/
  manifest.json
  resources/
  notices/
  licenses/
```

平台资源 API 只提供目录读取、详情读取和绑定；发布、下架和 revision 更新走导入 manifest 与部署流程。项目绑定保存 `platform_resource_id + platform_revision + variant_id + prompt_variant_id`，不会因平台目录发布新 revision 而静默变化。

## 共享资产类别

第一批类别与 open-ai-canvas 对齐，但在 iFrame 中保持独立的结构化类型：

- `style`：色彩、材质、笔触、摄影质感、风格执行计划。
- `genre_theme`：题材和叙事视觉方向，例如古装武侠、都市悬疑、广告产品片。
- `camera_motion`：机位、景别、运镜、跟焦、剪辑节奏和适用镜头类型。
- `effect`：可复用的环境或后期效果，如雾、雨、蒸汽、粒子、光线变化；不包含隐藏的全局负向提示。
- `character`：角色库条目、角色圣经、身份锚点和可用参考图。
- `environment`：地点/场景母版、空间结构、光影基线和地标。
- `prop`：道具结构、材质、尺寸关系和使用限制。
- `motion_reference`：用于试生产的参考视频及其运镜、动作和光影快照。
- `reference_set`：由多个明确角色组成的参考集；每个成员保留角色和版本身份。

`wardrobe`、`weapon`、`audio` 可作为角色或分镜引用的子类型，是否单独展示由 UI 过滤决定，不改变资源身份。

## 与 IYIShow 平台参考库契约的对齐

IYIShow 的平台参考库契约进一步区分了平台资源、媒体变体和结构化提示词变体。iFrame 当前的 `global` 资产池只能覆盖其中一部分，不能直接视为完整的平台资源层。

### 五道闸门

平台共享资源进入正式目录前必须经过：

1. **身份**：稳定 `resource_id`、平台 revision、媒体 `variant_id` 和 `prompt_variant_id`；URL 只作为运行时投影。
2. **结构**：结构化 schema、变量约束、模型适配和 provider projection 校验通过。
3. **来源**：仓库、commit、作者、许可证、内容 hash 和导入批次完整。
4. **引用**：脚本、剧集、分镜、容器和 Context IR 固定绑定具体 revision；替换使用并发安全的显式操作；删除先检查引用。
5. **质量**：技术就绪、提示词对齐、来源相关性、可复用性和连续性适配分别记录。

### 对 iFrame 当前模型的判断

已具备：

- 语义资产 `asset_id`
- 资产 `asset_revision`
- 图片/视频变体 `variant_id`
- `media_id` / `storage_key`
- `prompt_used` 和生成提交快照
- 项目、剧集、全局作用域
- 显式 promote / fork 和删除引用保护

尚未具备：

- 独立的平台 `resource_id` 与平台资源 revision
- `prompt_variant_id` 及字段级 provider projection
- `source -> import_job -> candidate -> review -> promote` 导入生命周期
- 独立的来源 manifest 和质量评分记录
- Context IR 的冻结绑定快照

因此，当前共享资产库只能作为第一阶段的结构化素材目录；平台风格、题材、运镜、特效、角色库和 skill 正式发布前，需要新增平台资源层，不能继续扩展 `GlobalAssetLibrary` 来承载全部治理职责。

### 推荐资源生命周期

```text
source
  → import_job
  → candidate
  → review
  → promoted platform resource
  → platform revision
  → media variant
  → prompt variant
  → binding
  → Context IR snapshot
  → runtime result
```

导入候选未通过来源、许可证和质量检查时，只能留在候选区，不得出现在普通共享搜索结果中。

### 结构化提示词变体

`prompt_used` 保留为历史证据，但不能作为唯一事实源。平台资源的提示词变体至少需要：

- `prompt_variant_id`、revision、status
- `prompt_schema_version`
- provider-neutral blocks：主体、场景、动作、镜头/运镜、光影、风格、音频和约束
- provider projection：面向具体模型的提示词或协议字段
- 来源资源、来源媒体变体、来源 skill/风格 revision
- 模型族、语言、创建者和创建时间
- 验收标准和质量状态

运行时只消费已冻结的 prompt variant revision，不能在任务执行期间按名称重新搜索平台目录。

## 资产记录与版本

共享资产必须包含以下字段：

```json
{
  "id": "stable-asset-id",
  "scope": "platform_shared",
  "kind": "style|genre_theme|camera_motion|effect|character|environment|prop|motion_reference|reference_set",
  "title": "可读名称",
  "summary": "用途说明",
  "tags": ["短剧", "古装", "黄昏"],
  "status": "draft|review|confirmed|archived",
  "revision": 3,
  "definition": {},
  "media": [],
  "provenance": {
    "source": "open-ai-canvas|iframe-native|user-contributed",
    "source_revision": "...",
    "license": "...",
    "attribution": "...",
    "source_url": "...",
    "notice_text": "...",
    "imported_at": "...",
    "content_sha256": "..."
  },
  "compatibility": {
    "asset_roles": ["scene", "shot"],
    "video_modes": ["t2v", "i2v", "first_last_frame", "r2v"],
    "models": ["h3", "seedance"]
  }
}
```

### 版权与直接导入规则

- 可以直接导入 open-ai-canvas 的参考库条目到 `platform_shared`，但导入器必须读取该条目的 source/license/NOTICE 信息并写入 `provenance`。
- MIT、Apache-2.0、CC0 等许可按其许可文本履行署名、NOTICE 和再分发要求；CC-BY 等许可必须保留作者、来源链接和署名文本。
- 仅有“官方文档参考”“方法论整理”或未标明许可的条目，不得作为可下载的媒体或可商用素材发布；可以标记为 `reference_only`，只在 iFrame 内展示来源和摘要。
- 版权信息必须在资产详情、复制确认窗口和导出/下载元数据中可见。用户不能删除或覆盖来源、许可证和署名字段。
- 每次导入记录源 revision、源文件内容 SHA-256 和导入时间。源库更新时创建新的共享 revision，不覆盖已经确认的旧 revision。
- 示例图片和视频继续显示“参考素材，不是 iFrame 生成结果”的披露；模型生成结果不得继承示例素材的作者署名到生成内容，除非许可明确要求。

`definition` 保存结构化参数，不把完整提示词作为唯一事实源。若资产含有可见提示词模板，模板必须属于 definition 的一个可检查字段，并在提交前显示给用户。

媒体项必须使用稳定媒体身份或资源 ID，不能把短期签名 URL 写入共享资产定义。展示、复制、模型输入分别实时签发有效 URL。

## 读取、导入与复制

### 共享资产读取

- 所有已登录 iFrame 用户可以检索和预览 `status=confirmed` 的共享资产。
- 共享资产只读；用户不能直接编辑共享 revision。
- 预览、下载、复制和模型输入使用不同的访问用途，沿用统一媒体访问封装。

### 显式导入

用户在角色、场景、道具或分镜设计中选择共享资产后，必须明确选择以下操作之一：

1. **仅引用**：当前设计保存共享资产 ID 和 revision，提交时显示来源；不创建本地副本。
2. **复制到项目**：创建项目级独立 revision，可编辑，不随共享资产后续更新而改变。
3. **复制到剧集**：创建剧集级独立 revision，用于本剧集一致性基线。
4. **复制到个人**：创建当前用户私有副本，适合继续实验。

“应用”不得默默把共享提示词追加到正文，也不得自动提升为剧集或全局约束。

### 设计工具输出

图片编辑、导演台、白模/预演和视频参考工具仍是独立设计工具。它们可以输出设计包，用户确认后才能导入共享、项目、剧集或个人目录。工具的临时状态不自动写入共享目录。

## 结构化引用规则

角色、场景、道具和分镜都可以引用共享资产，但必须保存：

- `source_asset_id`
- `source_scope`
- `source_revision`
- `application_mode`：`reference_only`、`copy_parameters`、`copy_parameters_with_media`
- 当前对象自己的结构化快照 revision
- 用户最后确认的可见提示词

应用共享资产后，当前对象形成独立快照。共享资产更新、归档或删除不会静默改写已确认的角色、场景、道具、图片变体或分镜。

## 资产库交互需求

缩图列表只负责展示媒体封面，不能作为资产库的唯一模型。资产库必须同时提供结构化目录和快速引用能力。

### 统一引用入口

输入 `@` 和点击“从资产库导入”必须调用同一个资产搜索/解析器：

```text
关键词或 @
→ 作用域过滤
→ 资产类型过滤
→ 结构化字段和标签匹配
→ 选择资产
→ 选择 revision
→ 选择变体
→ 选择应用范围
→ 写入统一引用记录
```

两种入口的区别只在交互意图：

- `@`：在正文或描述中插入一个可见的资产引用。
- “从资产库导入”：绑定角色、场景、道具、风格、光影、镜头或参考媒体字段。

两者最终都必须写入同一种引用结构：

```json
{
  "asset_id": "...",
  "scope": "shared|project|episode|private",
  "revision": 4,
  "variant_id": "...",
  "application_mode": "reference_only|parameters_only|parameters_with_media",
  "applied_fields": ["environment", "lighting", "style"],
  "source": "asset_picker|mention"
}
```

### 搜索结果必须显示结构化信息

搜索结果不能只显示缩图和名称，至少显示：

- 资产类型和作用域
- 当前 revision
- 可用变体
- 结构化摘要
- 可应用字段
- 是否有稳定参考图、参考视频或音色
- 来源、许可证和媒体状态

例如场景搜索结果应能显示空间、光影、镜头和人物密度摘要；角色结果应能显示身份锚点、服装和配件摘要。

### 应用范围必须显式选择

用户选择资产后，必须明确选择：

- 仅引用
- 仅复用结构化参数
- 复用参数并附带参考图
- 复用参数并附带参考视频
- 复制到项目/剧集/个人

系统不得因为用户选择了资产封面，就自动发送全部结构化字段或全部媒体。

### 提交前预览

角色、场景、3D 导演台和分镜提交前必须显示本次实际使用的资产清单：

```text
场景：青溪镇青石板长街
作用域：剧集 1
revision：4
变体：黄昏冷灰蓝
应用：光影 + 远景
参考图：1 张
结构化参数：已投影
```

预览还必须显示完整编译提示词。用户确认前，任何资产参数、参考媒体或拍摄计划描述都不得隐藏追加到模型请求。

### 资产本体与缩图分离

缩图是媒体变体的展示封面，不是资产本体。持久化引用必须保存 `asset_id`、`revision` 和 `variant_id`，不能只保存缩图 URL 或短期签名媒体 URL。实际显示、复制和模型输入时再根据稳定媒体身份签发有效地址。

## 提示词投影边界

共享资产的结构化定义进入当前设计的可见编译流程：

```text
共享资产定义
→ 当前对象结构化快照
→ 用户可编辑字段
→ 来源和 revision 展示
→ 完整可见提示词
→ 用户确认
→ 模型请求
```

禁止以下行为：

- 在模型返回正文后追加用户不可见的共享约束。
- 把共享资产名称当作已生效的视觉参数。
- 未选择参考图时自动发送共享媒体。
- 用共享资产的新 revision 覆盖当前项目或剧集的旧快照。

## 初始种子建议

第一批可从 open-ai-canvas 方法论和公开、可授权的条目整理为 iFrame 共享资产：

- 风格：统一视觉风格参考、短剧色彩风格帧、写实电影质感。
- 题材：古装武侠、现代悬疑、都市情感、产品广告。
- 运镜：缓慢推进、侧移、跟拍、过肩反打、轻微环绕、首尾帧过渡。
- 特效：雨、雾、蒸汽、尘埃、边缘光；每项需声明适用场景和禁用条件。
- 角色库：角色圣经、身份锚点、服装/武器/声音版本；只导入有明确来源和授权的角色。
- 参考集：场景母版、角色定妆图、动作参考视频和白模参考的组合包。

公开示例图和视频可以直接从 open-ai-canvas 参考库导入，但必须保留来源、授权、作者署名（如适用）和“仅供参考”声明；不得把第三方示例误标成 iFrame 生成结果。导入失败或许可证缺失时，条目不得进入共享目录。

## 分批实施计划

### 第 1 批：数据与访问边界

- 为资产记录增加 `scope=platform_shared`、provenance、revision 和 compatibility。
- 复用统一媒体访问封装，覆盖展示、复制、模型输入和过期续签。
- 增加共享资产只读、项目/剧集复制和跨用户拒绝测试。

### 第 2 批：种子和检索

- 将已核实、可授权的风格、题材、运镜、特效和角色条目导入种子文件。
- 在资产库“全部／共享”增加类别、标签、适用工作流和模型模式筛选。
- 显示来源、revision、适用范围和媒体状态。

### 第 3 批：设计工具接入

- 角色、场景、道具、分镜支持“仅引用／复制参数／复制参数并带参考媒体”。
- 生成前展示来源和完整编译提示词。
- 应用后保存当前对象独立快照，不建立实时继承。

### 第 4 批：平台发布治理

- 增加共享资产审核、归档和替代 revision。
- 对版权、来源、媒体稳定性和模型兼容性建立发布检查。
- 生产部署前执行共享资产读取、复制、媒体续签和用户隔离的端到端验证。

## 成功标准

- 用户能在“全部／共享”检索平台资产，并看到类别、来源、revision 和适用范围。
- 共享资产可被角色、场景、道具和分镜显式引用或复制。
- 未选择的共享素材不会进入模型请求。
- 任何共享参数都能在提交前以结构化字段和完整提示词显示。
- 共享资产更新不会改变已确认的项目、剧集或分镜快照。
- 共享媒体 URL 过期时，统一入口可以按稳定媒体身份重新签发。
