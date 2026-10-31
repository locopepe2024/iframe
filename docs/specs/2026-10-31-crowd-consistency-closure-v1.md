# 群演一致性收口 V1

## 目标

将固定群演和群演模板纳入与角色、场景、道具相同的可追踪引用边界，同时保留两种不同用途：

- `fixed_extra`：有稳定外观、可在近景辨认的固定群演；
- `extra_template`：只约束服装族、体态范围、色彩和行为类别的人群模板，不锁定单一面孔。

本规格不要求群演自动生成图片，也不增加导演台审核门槛。群演的元数据由资产库保存；固定群演的具体造型由 Character Workbench 生成并由用户绑定。

## 已观察到的现状

- 剧本实体提取已经输出 `crowd_groups`，并经过用户确认后进入 `Series.extra_roster`。
- Storyboard 使用 `ExtraShotInstance` 保存当前镜头的层级、区域、朝向、运动、可辨认面孔和变体。
- 角色、场景、道具已有 `AssetRevisionPin` 和 `AssetReferenceIndex`；群演目前使用独立 roster，未进入统一 index。
- `StoryboardConsistencyManifest` 会保存群演 roster 的副本，但 `ExtraRosterEntry` 没有独立的资产 revision 链。

## Owner 边界

| 对象 | 唯一 owner | 允许读取 | 不负责 |
|---|---|---|---|
| 群演分类与模板 | Series Asset Library | Script、Storyboard、3D 导演台 | 当前镜头站位和动作 |
| 固定群演造型 | Character Workbench 绑定的 Character asset | Storyboard、Shot Design、3D 导演台 | 群体行为和镜头调度 |
| 当前镜头群演实例 | Storyboard | Shot Design、3D 导演台 | 修改系列群演定义 |
| 近中远景行为 | Storyboard / 街道群像 Skill | Prompt compiler、3D 导演台 | 生成永久资产 |
| 群演引用快照 | Storyboard frame / VideoTask | 生成任务和回溯 | 实时跟随当前 roster |

Cast 只展示本集出场并提供进入资产库的入口；Assets/Series Asset Library 负责创建、编辑和保存群演定义。群演编辑器修改 roster 元数据，不直接生成角色图片。

## 最小数据闭环

### 资产库

固定群演或模板需要稳定的：

```text
extra_id
kind
asset_revision
reference_variant_ids
reference_media_ids
visual_asset_id（fixed_extra 可选）
```

每次修改群演定义生成新 `asset_revision`，旧 revision 保留可读；不覆盖已锁定镜头。

### Storyboard

`ExtraShotInstance` 增加当前使用的：

```text
extra_id 或 template_id
asset_revision
variant_ids
layer / region / facing / motion
face_readable / text_readable
```

锁定分镜或视频任务必须保存群演 revision、variant 和 media identity。未锁定分镜在资产变更后显示 stale/missing，不自动替换。

### 统一引用索引

`AssetReferenceIndex` 增加 `crowd` 条目，或提供等价的统一解析器。不能让角色、场景、道具走 revision pin，而群演只走当前 `extra_roster`。

## 场景与镜头分工

- 场景资产：固定空间、人群区域、默认密度、可复用路线、固定招牌文字。
- Storyboard：当前镜头的群演身份、近中远景、屏幕区域、可见性、信息差、反应和时间轴。
- 同一地点的不同社会群体不得因为地点相同而合并。
- “粮铺能看到阁楼”和“阁楼能看到粮铺”应记录为双方地点之间的结构化可见关系；暂时未知的距离、高度、遮挡必须保留为 uncertainty。

## 成功标准

1. 群演能从实体提取进入系列资产库，并在 Cast 与 Assets 中稳定出现。
2. 固定群演可绑定一个 Character 造型，模板不被误当成固定脸。
3. Storyboard 能引用群演 revision/variant，并在变更或删除后显示缺失或 stale。
4. 视频任务保存群演的 immutable snapshot。
5. 首帧和视频请求的实际 payload 都包含当前镜头确认的群演上下文。
6. 近景可辨认群演、中景群演模板、远景匿名人群可以分别验证。

## 当前未证明

- 所有 provider 请求都消费了群演实例和变体。
- 群演删除或修改后的 stale 行为已经覆盖所有生成入口。
- 群演已经进入 Director Shooting Plan 的自动 handoff。

## 验证命令

```bash
pytest -q tests/test_entity_variants.py tests/test_reconcile_crowd_groups.py tests/test_project_crowd_groups.py tests/test_storyboard_continuity_sheet.py
cd frontend && npm run test:ui -- --run src/components/modules/Cast.test.tsx src/components/modules/ConsistencyVault.test.tsx src/components/shared/CrowdGroupEditor.test.tsx
```

端到端验收还需要使用真实粮铺剧本：提取群演 → 合并到系列 → 打开 Cast/Assets → 绑定固定群演造型 → 在 Storyboard 添加近/中/远景实例 → 检查首帧和视频提交 payload。
