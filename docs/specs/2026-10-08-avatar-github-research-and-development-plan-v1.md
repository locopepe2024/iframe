# Avatar 开源项目调研与开发计划 V1

状态：调研与计划；不代表已选定模型或已完成生产接入  
日期：2026-10-08

> 2026-10-08 修订：下文原始 P1-P4 方案将参考素材、候选和跨项目采用误划给 Avatar，已被 `2026-10-08-avatar-identity-service-v1.md` 的责任边界取代。GitHub 项目调研仍可用，实施计划以本文件末尾的修订计划为准。

## 结论摘要

没有找到一个开源仓库同时提供以下完整能力：

```text
人物身份创建
  + 人脸/身材结构化设计
  + 多职责参考素材
  + 不可变身份 revision
  + 候选与确认状态
  + 跨项目采用绑定
```

开源项目主要分成三类：身份保持图像生成、参数化 3D 人体、实时数字人运行时。Avatar 服务应先建立自己的身份数据和版本边界，再把图像生成或 3D 运行时作为可替换能力接入。

## GitHub 调研

检索日期：2026-10-08。Star 数量和更新时间是检索时的运行时观察，不是质量或生产适用性的证明。

| 项目 | 代码事实 | 可借鉴 | 不应直接推断 |
|---|---|---|---|
| [InstantID](https://github.com/instantX-research/InstantID) | Apache-2.0；约 11.9k stars；单张人脸做 zero-shot identity-preserving generation；README 明确当前不支持多人 | 身份参考图 → 生成候选的适配器边界；参考图职责和生成任务应分开 | 它不是人物库、revision 服务或审核系统；InsightFace 模型和 checkpoint 另有研究许可限制，需单独核验 |
| [PhotoMaker](https://github.com/TencentARC/PhotoMaker) | 代码仓库标注 Other license；通过 stacked ID embedding 做人物定制；支持 V1/V2、ControlNet/IP-Adapter 等组合 | 多参考图聚合、候选生成任务和模型版本记录 | 不提供人物身份持久化、项目绑定或素材职责模型；仓库许可不能替代模型权利审查 |
| [PuLID](https://github.com/ToTheBeginning/PuLID) | Apache-2.0；约 3.5k stars；身份定制，支持 SDXL/Flux 版本和本地 Gradio | 生成后端的 provider adapter、模型/权重版本记录、身份相似度评估入口 | 不提供角色档案、身份 revision 或生产审核流 |
| [MakeHuman](https://github.com/makehumancommunity/makehuman) | 角色创建应用；参数化人体与插件生态；仓库许可证为 Other | 身材比例、体型、身高感等结构化参数的设计思路；可作为 3D 身体参考来源 | 不是真人脸身份服务，也不是头像图片生成服务；资产许可和目标模型兼容性需核验 |
| [OpenAvatarChat](https://github.com/HumanAIGC-Engineering/OpenAvatarChat) | Apache-2.0；模块化 ASR/LLM/TTS/Avatar 运行时；支持 LiteAvatar、LAM、MuseTalk、FlashHead 等 | 将 Avatar 运行时作为独立 provider；运行时形象与身份库解耦 | 它解决实时对话数字人，不解决人物身份设计、图片 lineage 或跨项目版本 |
| [Hunyuan3D-2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1) | Other license；图像到高保真 3D 资产和 PBR 材质生成 | 后续 3D 身体/服装资产生成的候选后端 | 不能作为人物身份权威来源；3D 资产生成不等于身份一致性验证 |

### 证据边界

- **代码事实**：上述能力和许可证来自仓库 README、GitHub repository/license API 的检索结果。
- **直接 implication**：这些项目适合作为 Avatar 的生成或运行时 adapter，而不是身份数据库本身。
- **尚未证明**：任何项目在我们的中文人物设计、真人相似度、跨镜一致性和商业部署场景下的实际效果。
- **需要验证**：模型权重、依赖模型、训练数据和输出使用条款，尤其是标为 Other 的仓库。

## 当前 iFrame 状态

### 已有

- `config/agent_skills/character-identity-design.md` 已定义脸型、五官、眼眉鼻唇、肤色肤质、身材体态、发型和识别锚点等设计字段。
- `src/apps/avatar/service.py` 已有独立 Avatar 身份服务第一版：按用户创建人物、保存文字身份、读取历史 revision、乐观并发冲突。
- 数字分身入口已调用 `/avatar/characters` 创建和读取人物。
- 项目角色的 `Character.digital_avatar` 和 `design_revisions` 仍是迁移期数据，不能作为 Avatar 权威存储。

### 缺口

- 身份参考图上传、裁切、质量检查和职责标注。
- 身份候选生成任务与 provider/model 版本记录。
- 候选接受、拒绝、确认和审核历史。
- 图片/视频/声音/动作资产的 lineage。
- Avatar 人物向 iFrame 项目的采用绑定。
- 3D 导演台读取已确认 `avatar_character_id + identity_revision` 的接口。
- 结构化字段的 `basis`（用户指定、已确认 Avatar 值、参考素材或创意设计选择）。

## 目标数据模型

### 1. AvatarCharacter

```json
{
  "character_id": "avatar_01",
  "name": "Mira",
  "status": "draft",
  "current_identity_revision": 2,
  "created_at": "...",
  "updated_at": "..."
}
```

`character_id` 是跨项目稳定 ID。名称可编辑，但不能充当身份键。

### 2. IdentityRevision

```json
{
  "character_id": "avatar_01",
  "identity_revision": 2,
  "status": "draft | needs_user_review | confirmed | stale",
  "identity": {
    "face": {"value": "瓜子", "basis": "user_specified"},
    "facial_features": {"value": "丹凤眼", "basis": "user_specified"},
    "skin": {"value": "中等偏暖肤色", "basis": "user_specified"},
    "body": {"value": "匀称", "basis": "creative_design_choice"},
    "age_appearance": {"value": "18-20", "basis": "user_specified"},
    "gender_expression": {"value": "女", "basis": "user_specified"},
    "base_hair": {"value": null, "basis": null},
    "identity_anchors": []
  },
  "parent_revision": 1,
  "change_summary": "补充五官和体态",
  "created_by": "user",
  "created_at": "..."
}
```

空值表示未指定，不自动填入通用质量短语，也不从姓名、职业、族裔或性格推断。

### 3. ReferenceAsset

```json
{
  "reference_asset_id": "ref_01",
  "character_id": "avatar_01",
  "identity_revision": 2,
  "role": "identity | clothing | action | scene",
  "uri": "...",
  "preview_uri": "...",
  "source": "upload | generated | imported",
  "lineage": {"provider": "instantid", "model": "...", "task_id": "..."},
  "review_status": "candidate | accepted | rejected",
  "created_at": "..."
}
```

参考图职责必须单选。服装图和动作视频不能隐式变成人脸身份来源。

### 4. CandidateTask

记录生成请求和输出，但不自动改变当前身份：

```json
{
  "task_id": "avatar_task_01",
  "character_id": "avatar_01",
  "source_identity_revision": 2,
  "input_reference_asset_ids": ["ref_01"],
  "provider": "instantid",
  "model_revision": "...",
  "prompt_projection": {"visible_identity": ["瓜子", "丹凤眼"]},
  "status": "queued | running | succeeded | failed",
  "output_reference_asset_ids": []
}
```

### 5. ProjectAdoption

由 iFrame 持有，指向 Avatar，不复制 Avatar 媒体：

```json
{
  "binding_id": "binding_01",
  "project_id": "project_01",
  "project_character_id": "cast_01",
  "avatar_character_id": "avatar_01",
  "identity_revision": 2,
  "base_reference_asset_ids": ["ref_01"],
  "status": "draft | confirmed | stale"
}
```

上游 revision 改变时绑定变为 `stale`，不能静默重写项目或镜头引用。

## 开发计划

### P0：身份库底座

- 将当前 JSON 存储抽象为 `AvatarRepository`，保留 owner scope 和原子写入。
- 增加 `IdentityRevision` 的完整历史字段、`basis`、变更摘要和审计时间。
- 增加 schema/version 校验、历史 revision 列表和明确 404/409 错误码。
- 数字分身页支持人物列表、创建、编辑当前草稿、查看历史版本。

验收：两个用户互不可见；旧 revision 可复现；并发旧写入返回 409。

### P1：身份参考图

- 实现 Avatar 专属上传存储，不写 `/library/assets`。
- 图片输入先做角色身份职责、尺寸、脸部检测和质量状态记录；质量未通过只能是候选。
- 参考图与 `character_id + identity_revision` 绑定，支持撤回和替换但不改写历史。

验收：身份图、服装图、动作图职责隔离；删除当前参考图不影响旧 revision lineage。

### P2：候选生成 adapter

- 定义 `AvatarGenerationProvider`，provider 不直接写身份库。
- 先接一个身份保持图像后端做离线实验，候选任务记录 provider/model/checkpoint。
- 对 InstantID、PuLID、PhotoMaker 做同一组参考图和提示词的可比评测；不要仅按 GitHub stars 选型。
- 评测 ID 相似度、姿态/构图可控性、肤色/体态漂移、失败率、成本和延迟。

验收：生成成功只新增候选；用户确认后才产生可引用的 `accepted` 资产。

### P3：确认和采用

- 增加审核动作：接受、拒绝、撤回、标记 stale。
- 实现 iFrame `ProjectAdoption` API；项目只保存 Avatar ID、revision 和快照元数据。
- 3D 导演台只消费已确认版本，拒绝 draft/candidate。

验收：上游 revision 更新后旧镜头仍可复现，并显示 stale 提示。

### P4：3D 与声音/动作扩展

- 将身体参数和 3D reference 作为独立职责接入；MakeHuman/Hunyuan3D 仅作为实验 adapter。
- 运行时数字人（OpenAvatarChat 等）作为消费层，不把运行时模型写入身份 revision。
- 声音、动作和服装继续使用独立 reference role 和 lineage。

## 选型原则

1. 身份服务先于生成模型；模型可替换，人物 ID 和 revision 不可替换。
2. 生成候选不是确认身份；成功任务不是生产可引用版本。
3. 参考素材按职责隔离；身份图不能被服装、动作或场景图静默污染。
4. 许可证、模型权重和依赖模型分别审核；仓库许可证不是完整商业许可结论。
5. 先做离线小样本评测，再决定接入哪个 provider；GitHub 热度只作为发现信号。

## 验证命令

```bash
gh search repos "InstantID" --limit 8 --json fullName,description,url,stargazersCount,updatedAt,license
pytest -q tests/test_avatar_service.py
cd frontend && npm run typecheck
cd frontend && npm run test:ui -- src/components/avatar/AvatarWorkbench.test.tsx
```

## 修订开发计划

1. Avatar 完成人物创建、设计路线、稳定身份字段、造型说明、设计依据、未决项及人工确认的设计 revision。独立入口已接入现有设计草稿生成 API。
2. 将人物档案与设计草稿输入持久化，完善字段级依据与已确认值冲突提示；模型建议默认标为创意设计选择。
3. 设计规格只读输出给 iFrame 资产生成流程。素材库继续管理参考图、候选、图片版本和确认；项目工作流管理采用绑定。
4. 对 InstantID、PuLID、PhotoMaker 等仅做生成适配器评测，不把这些仓库当人物设计数据源。3D 运行时作为消费方。

验收重点：Avatar 中能独立完成可编辑的人物角色设计；没有素材库依赖或媒体生命周期复制；确认版本可复现；项目角色接入由后续 iFrame 工作流单独实现。
