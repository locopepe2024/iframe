# Avatar 人物设计服务 V1

状态：独立人物设计入口；文字设计草稿、确认和版本读取已实现。日期：2026-10-08。

## Observed

- `CharacterWorkbench` 已通过 `character-design/draft` 生成可编辑的 `identity.visual_notes`、`look.visual_notes` 和 `unresolved`。
- iFrame 资产库已经管理参考素材职责、候选确认、图片 revision 与跨项目采用。
- Avatar 服务在 `src/apps/avatar/service.py` 按 owner 存于 `output/users/<owner>/studio/avatar/characters.json`。

## 责任边界

| 系统 | 责任 |
|---|---|
| Avatar | 创建人物；维护稳定身份字段、设计路线、年龄阶段、视觉说明、设计依据、待确认问题和确认的设计 revision |
| iFrame 资产库 | 参考图片、素材职责、生成候选、图片 revision、候选确认 |
| iFrame 项目流程 | 角色与素材的项目采用和引用绑定 |
| 3D 导演台 | 空间、动作、镜头执行，消费设计和素材引用 |

Avatar 输出人物设计规格，不持有 `ReferenceAsset`、`CandidateTask`、媒体 lineage 或 `ProjectAdoption`。

## 数据与接口

`AvatarCharacter` 包含稳定 `character_id`、名称、`design_revision`、`review_status` 及 `character_design`。`character_design.design_draft` 可编辑；`design_revisions` 仅保存确认设计。每次写入带 `expected_revision`，旧版本读取通过 `?revision=N`；冲突返回 409。`basis` 和 `field_status` 保留设计值来源，空值不自动推断。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET/POST | `/avatar/characters` | 列表、创建 |
| GET | `/avatar/characters/{id}?revision=N` | 当前或历史设计 |
| PUT | `/avatar/characters/{id}/design` | 保存草稿或确认设计，使用 `expected_revision` 与 `confirmed` |
| PUT | `/avatar/characters/{id}/identity` | 旧版平面字段兼容入口 |

独立数字分身页调用现有 `/character-design/draft` 获取模型建议，用户编辑并确认后才写入确认 revision。角色工作台接入尚未实现；项目绑定仍由 iFrame 侧设计。

## 设计闭环补全

- `profile` 与人物名称必须随人物保存；重新进入数字分身时恢复，并作为下一次草稿生成的输入。
- 保存草稿和确认设计都使用 `expected_revision`；历史版本只读，选择历史版本不能覆盖当前草稿。
- 确认时至少需要具体的身份视觉描述或结构化稳定身份值；无效确认不增加 revision。
- 素材库可由 Avatar 显式读取或写入，和 Agent 使用同一 iFrame API；素材、候选和项目绑定仍由 iFrame 管理。此阶段设计闭环不依赖素材库读写。
- 旧版仅有 `identity` 的人物应以兼容投影读出，不在读取时改写存储。

## 验证

`pytest -q tests/test_avatar_service.py`；`cd frontend && npm run typecheck && npm run test:ui -- AvatarWorkbench`。
