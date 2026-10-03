# Digital Avatar Character Design Board v1

## 目标

角色工作台的目标是生产可复用的真人 AI 角色资产。它不是一个把形容词追加到图片提示词的面板，也不是生成后修图工具的替代品。

角色工作台要让用户建立一套可回溯的角色资产：

- 角色身份稳定
- 真人外观可控
- 造型可以按集、场景和镜头变化
- 表演状态不会污染永久身份
- 参考图、声音和动作各自有明确职责
- 用户可以接受、修改、删除 AI 建议
- 输出可以供图片、视频、声音和分镜继续使用

## 分层模型

### 1. 永久身份 Identity

跨系列和跨集保持稳定的属性：

- 年龄阶段
- 性别表达（由用户指定）
- 脸型和五官结构
- 眼型、眼睛颜色、眉形、鼻唇特征
- 基础发型、发际线和发色
- 肤色、肤质和稳定的面部识别特征
- 身材比例、体型、身高感和肩颈比例
- 一至两个识别锚点

这些内容组成角色的身份基线。没有用户输入或参考证据时，不根据姓名、职业、族裔或剧情自动推断脸型、肤色、身材和服装。

### 2. 造型变体 Look

在指定范围内生效的可变资产：

- 年代和地域服装
- 本集服装
- 发型整理
- 妆容
- 伤势、湿污、疲态
- 配饰
- 造型生效的场景和镜头范围

造型变体不能改写永久身份。每个变体必须带有 `scope` 和 `revision`。

### 3. 表演状态 Performance

只属于当前镜头或动作的状态：

- 表情
- 眼神方向
- 姿势
- 手位
- 动作
- 情绪强度
- 景别和灯光

表演状态不得写回身份或造型变体。

### 4. 声音与动作 Voice / Motion

声音和动作是独立资产：

- 声音身份与音色复刻
- 语言、口音和语速
- 动作参考视频
- 动作轨迹和身体重定向
- 口型与表演绑定

声音和动作不能作为脸型或服装的隐式来源。

## 工作台区域

### A. 身份卡

用户可以编辑结构化字段，并看到：

- 当前值
- 来源（用户输入、参考图、剧本事实或 AI 建议）
- 是否已确认
- revision

### B. 真人外观特征库

按类别提供可选建议，而不是一串质量排除词：

- 眼神与眼部
- 五官
- 发型
- 肤色与肤质
- 身材与体态
- 年龄感
- 识别锚点

点击建议才进入草稿。用户可以修改或删除建议。

### C. 造型变体

用户可以创建、复制、命名和回溯造型版本，并指定：

- 生效集数
- 生效场景
- 生效镜头
- 服装、妆容、发型和配饰

### D. 参考素材职责

每张参考图必须标注职责：

- 身份参考图
- 服装参考图
- 动作参考图
- 场景参考图

系统不得把不同职责的参考图自动混成一个身份来源。

### E. 生成候选

模型返回的是可编辑候选，不直接覆盖身份或造型。用户可以：

- 接受
- 继续编辑
- 删除
- 设为当前版本
- 保留为候选版本

### F. 图片编辑

图片编辑是一级工作台，用于生成后的局部修整。它不修改角色身份、造型变体或 Director 理解。

## 输出契约

角色工作台应产生以下可引用资产：

```json
{
  "schema_version": "digital-avatar-character.v1",
  "character_id": "...",
  "identity_revision": 3,
  "look_revision": 2,
  "identity": {},
  "look_variants": [],
  "continuity_locks": [],
  "reference_assets": [],
  "voice_asset_id": null,
  "motion_asset_ids": [],
  "review_status": "needs_user_review"
}
```

生成图片和视频保存 `identity_revision`、`look_revision`、参考素材职责和生成 lineage，方便后续检索和回溯。

## 与 Director 的边界

- Director 提供时代、地点、视觉基调和可选视觉锚点。
- Director 的 `story_map`、`canon_state`、事实账本和内部元数据不能直接进入角色图像提示词。
- 角色工作台只读取经过投影的可执行视觉约束。
- 角色工作台的修改不会反向修改 Director 理解或拍摄计划。

## Avatar 素材库边界

iframe 不重复实现角色素材库、参考图存储或真人角色资产版本服务。上述能力由 Avatar 素材库提供，iframe 通过适配器调用。

当前 `Character.digital_avatar` 只能视为迁移期间的过渡数据。它可以帮助旧项目保留用户已经确认的身份、造型和连续性选择，但不能发展为 iframe 内部的 Avatar 素材库，也不能成为生产环境的权威角色存储。

iframe 不应继续扩展本地 Avatar 素材库 CRUD。角色、参考图、候选版本、声音和动作资产的最终持久化与版本管理必须由 Avatar 服务负责。iframe 内的本地 mock 只能用于开发和自动化测试，必须通过显式配置注入，不能在生产环境静默回退为本地存储。

### iframe 负责

- 展示角色身份、造型变体和连续性锁。
- 将用户选择、修改和删除转换为结构化更新。
- 请求 Avatar 生成角色候选。
- 展示候选并允许用户接受、继续编辑或删除。
- 将当前 `character_id`、`identity_revision` 和 `look_revision` 传递给后续工作流。
- 在生成 Prompt 前投影必要的视觉约束，不把 Director 内部 JSON 直接传入 Avatar。

### Avatar 负责

- 角色素材库的持久化、检索和版本管理。
- 身份参考图、服装参考图、动作参考图和声音/动作资产的职责管理。
- 真人角色候选生成及候选版本保存。
- 角色图片、视频、声音和动作资产的 lineage 记录。
- 向 iframe 返回可引用的角色资产版本，而不是要求 iframe 保存图片副本。

### 最小调用契约

```ts
interface AvatarCharacterAssetClient {
  getCharacter(characterId: string): Promise<DigitalAvatarCharacter>;
  updateIdentity(characterId: string, patch: IdentityPatch): Promise<DigitalAvatarCharacter>;
  createLookVariant(characterId: string, input: LookVariantInput): Promise<DigitalAvatarCharacter>;
  generateCandidate(characterId: string, input: CandidateRequest): Promise<AvatarCandidateTask>;
  listReferenceAssets(characterId: string, role?: ReferenceRole): Promise<ReferenceAsset[]>;
}
```

`AvatarCharacterAssetClient` 是角色工作台的唯一依赖边界。工作台不应直接依赖 Avatar 的 HTTP 细节，也不应直接读取本地图片路径。生产环境由 Avatar HTTP adapter 注入，测试环境可以注入 mock client。

所有写入必须带有 `character_id`、当前 revision 和操作者来源。Avatar 返回的版本如果已经过期，iframe 应提示用户刷新角色状态，不得静默覆盖新的身份或造型。

### 与 3D 导演台的连接

场景、运镜、人物动作和空间关系由 3D 导演台负责。3D 导演台只读取 Avatar 返回的已确认角色资产：

```json
{
  "character_id": "...",
  "identity_revision": 3,
  "look_revision": 2,
  "reference_asset_ids": ["..."],
  "continuity_lock_ids": ["..."],
  "review_status": "confirmed"
}
```

3D 导演台不能把 iframe 的本地图片副本当作权威身份来源。图片副本最多是预览缓存，必须带有 Avatar 资产 ID 和版本；当本地预览与 Avatar 版本不一致时，应重新读取 Avatar 资产，不能继续使用旧副本编译正式动作或渲染任务。

3D 导演台可以生成姿态、动作轨迹、IK 和镜头安排，但不能修改角色永久身份。角色工作台的身份更新也不会反向触发 Director 理解或拍摄计划重算；只有明确引用了新角色版本的下游任务才需要重新执行。

## 当前代码状态与迁移边界

### 已观察到的代码事实

- iframe 当前 `Character` 模型已经可以暂存 `digital_avatar` 结构。
- 当前角色工作台仍通过项目资产更新接口写入角色对象；这只能作为开发过渡，
  不能被视为 Avatar 素材库的最终所有权实现。
- 当前仓库还没有可调用的 Avatar 服务端点，因此不能在 iframe 内伪造一个
  “远程素材库已经存在”的实现。

### 迁移要求

- 新增或扩展 Avatar 字段时，优先定义 `AvatarCharacterAssetClient` 的请求/响应
  类型，不继续扩展 iframe 本地素材库的 CRUD 责任。
- 角色工作台可以保留本地 mock/fixture 适配器用于开发测试，但 mock 必须显式
  标记为开发实现，不能默默降级成生产本地存储。
- 接入真实 Avatar 服务后，角色工作台的身份、造型、参考图和候选操作必须走
  Avatar 适配器；iframe 只保存当前引用的 `character_id`、版本和工作流快照。
- 3D 导演台不得读取 iframe 本地角色图片副本作为权威身份来源。

### 下一步实现顺序

1. 在 iframe 内建立 Avatar contract types 和注入式 client interface。
2. 建立仅用于测试的 in-memory/mock client，并覆盖 revision 冲突和候选接受。
3. 将角色工作台的保存、候选生成和参考素材读取改为调用 client。
4. 等 Avatar 服务 API 确认后，再实现 HTTP adapter；不提前猜测供应商路径。
5. 将 3D 导演台的角色引用收窄为 `character_id + identity_revision + look_revision`。

## 角色工作台的生成顺序

1. 从 Avatar 读取当前角色资产和版本。
2. 用户编辑结构化身份或造型字段。
3. iframe 生成一份可读的视觉提示投影供用户检查。
4. 用户确认后调用 Avatar 生成候选。
5. Avatar 返回候选资产和 lineage。
6. 用户接受、继续编辑、删除或保留候选。
7. 只有用户确认的版本才能被 3D 导演台、分镜和视频生成引用。

未确认的候选不能覆盖当前角色身份，也不能自动写入连续性锁。

## 本地素材导入迁移要求

当前未提交实现中的：

```text
POST /series/{series_id}/assets/import-from-library
fork_library_asset_to_series()
```

仍然会把全局素材复制进 iframe 的系列资产池。这与 Avatar 权威资产边界冲突，后续必须改为保存 Avatar 资产引用和版本，例如：

```json
{
  "avatar_character_id": "character_123",
  "identity_revision": 3,
  "look_revision": 2,
  "source": "avatar",
  "preview_url": "..."
}
```

迁移完成前，旧 deep-copy 路径必须标记为 legacy，不得继续扩展新的本地角色素材 CRUD。新实现顺序如下：

1. 定义 contract types 和注入式 `AvatarCharacterAssetClient`。
2. 建立仅用于开发测试的 mock client。
3. 角色工作台改为通过 client 读取和写入角色。
4. Avatar 服务 API 确认后，再实现 HTTP adapter。
5. 3D 导演台只引用 `character_id + identity_revision + look_revision`。

## v1 成功标准

1. 用户能建立一个稳定的真人角色身份。
2. 用户能创建至少一个本集造型变体。
3. 用户能看到并编辑眼神、五官、身材、皮肤等特征建议。
4. 生成提示词不包含完整 Director JSON。
5. 图片、声音、动作和造型参考职责可分别追溯。
6. Cast 和资产库角色入口使用同一个角色工作台。
