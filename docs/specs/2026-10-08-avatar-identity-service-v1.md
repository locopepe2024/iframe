# Avatar 人物身份服务 V1

状态：已实现文字身份创建与版本读取；图片资产和生成候选未实现  
日期：2026-10-08

## Observed

- 既有“人脸设计”由 `character-identity-design` Skill 提出可编辑的脸型、五官、肤色、发型等字段；它不创建人物，也不保存图片。
- 项目角色的 `Character.digital_avatar` 是过渡数据，不是跨项目人物身份的权威存储。
- iFrame 全局资产库保存图片素材和本地角色，不承担 Avatar 人物创建。

## 当前边界

`src/apps/avatar/service.py` 是独立的 Avatar 身份所有者。按当前用户隔离存放在 `output/users/<owner>/studio/avatar/characters.json`，不写入项目角色或全局资产库。

接口：

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/avatar/characters` | 当前用户的人物列表 |
| `POST` | `/avatar/characters` | 创建人物和第一版身份草稿 |
| `GET` | `/avatar/characters/{id}?revision=N` | 读取当前或历史身份版本 |
| `PUT` | `/avatar/characters/{id}/identity` | 带 `expected_revision` 更新身份，冲突返回 409 |

创建输入为 `name` 和结构化 `identity`。稳定身份字段包括脸部结构、五官、肤色肤质、身材体态、年龄外观、性别表达、基础发型与识别锚点。新人物返回 `avatar_*` ID、`identity_revision=1` 和 `draft` 状态。更新保留旧版内容，产生 `needs_user_review` 的新 revision。

## 限制与下一步

- 当前仅保存文字设计；没有身份参考图上传、视觉候选生成、图片版本、审核确认或跨项目采用接口。
- Skill 的建议仍需用户审阅后手动写入身份字段，不自动把性格或剧情事实推断为脸型、肤色和体态。
- 参考图片可以来自用户上传，或由用户显式选择 iFrame 素材作为输入；最终身份图片及 lineage 应归 Avatar 管理。
- 角色工作台接入应只读已确认的 `avatar_character_id + identity_revision`；不应把项目 `digital_avatar` 当作此服务的存储后端。

## 验证

- `pytest -q tests/test_avatar_service.py`
- `cd frontend && npm run typecheck`
- `cd frontend && npm run test:ui -- src/components/avatar/AvatarWorkbench.test.tsx`
