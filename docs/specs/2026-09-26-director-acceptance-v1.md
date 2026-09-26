# Director 测试验收说明 v1

## 目的

本说明把 Director 相关设计 spec 转换成可重复执行的验收门。它覆盖：

- Director 故事理解 `story_map`
- 角色关系、阶段时间线、事件和剧情线可视编辑
- Director shooting plan 的 scene → beat → shot 结构
- 草稿、确认、历史 revision 和 stale 防护
- 场景连续性、节拍时长和来源分块
- Director 与 Storyboard/Motion 的边界

本说明不把 Storyboard handoff 当作当前 Director confirm 的一部分。

## 规范基线

- `docs/specs/2026-09-25-director-visual-review-workbench-v1.md`
- `docs/specs/2026-09-26-director-shooting-plan-v1.md`
- `docs/specs/2026-09-26-director-plan-storyboard-handoff-v1.md`

## 证据等级

| 标记 | 含义 |
| --- | --- |
| Code fact | 代码或测试直接证明 |
| Runtime observation | 实际运行环境返回的结果 |
| Algorithm implication | 由模型/校验结构直接推出 |
| Hypothesis | 尚未由代码或运行验证的判断 |

## 验收矩阵

### A. 故事理解与 story_map

| 验收项 | 必须满足 | 当前验证 |
| --- | --- | --- |
| 稳定结构 | `people`、`phases`、`events`、`relationship_arcs`、`story_threads` 有稳定 ID | Code fact：`models.py` 严格 Pydantic 模型 |
| 角色关系 | 关系状态通过 `phase_id` 记录，触发事件通过 `trigger_event_ids` 引用 | Code fact：模型校验和 UI 编辑器 |
| 时间线 | 时间线只表达 phase/event 顺序，不伪造精确原文范围 | Code fact：`DirectorStoryMapSection` 和 spec |
| 旧数据 | legacy `timeline` / `relationships` 可读，但不会自动转成精确阶段关系 | Code fact：`createDirectorStoryMapFromLegacy` 和 UI 提示 |
| 事实边界 | `explicit` 引用必须来自已确认 Fact Ledger revision | Code fact：pipeline/model 校验 |
| 图表一致性 | 时间轴、关系图、剧情线读写同一 `story_map` | Code fact：同一前端 draft object |
| 键盘路径 | 图形选择有列表/表单等可操作替代路径 | Code fact：UI 测试和组件结构 |

### B. Director shooting plan

| 验收项 | 必须满足 | 当前验证 |
| --- | --- | --- |
| 层级 | ordered scenes contain ordered beats; beats contain ordered shots | Code fact：模型连续 order 校验 |
| 镜头来源 | shot 数只来自 `scenes[].beats[].shots[]` | Code fact：counts 和模型结构 |
| 视觉字段 | shot 包含表演、动作物理、构图、景别、机位、运镜、光影、声音和时长 | Code fact：LLM 契约校验 + Pydantic |
| 连续性 | scene 支持 `continues_previous_scene`、`continuity_in`、`continuity_out` | Code fact：当前 continuation slice |
| 节拍时长 | beat 可记录 `duration_seconds` 和 `keep_with_next` | Code fact：当前 continuation slice |
| 来源分块 | beat/scene 保留生成来源 chunk，不把 chunk 边界当语义场景边界 | Code fact：pipeline chunk stitching |
| 资源引用 | character/prop/event ID 必须属于当前有效集合 | Code fact：pipeline validation |

### C. 草稿、确认和 revision

| 验收项 | 必须满足 | 当前验证 |
| --- | --- | --- |
| 草稿保存 | expected source/draft revision 不匹配时拒绝覆盖 | Code fact：`tests/test_director_shooting_plan.py` |
| 确认门 | 未保存、字段不完整或 lineage stale 时拒绝确认 | Code fact：同上 |
| 历史 | confirmed plan 以不可变 revision 保存，可恢复为新草稿 | Code fact：同上 |
| 确认边界 | confirm 只激活 shooting-plan revision | Code fact：确认接口没有修改 Storyboard/Motion |
| 下游隔离 | confirm 不创建 Storyboard frame、不创建视频任务、不调用 LLM | Code fact：API 测试断言 |

### D. UI 验收

| 验收项 | 命令/测试 |
| --- | --- |
| 故事理解编辑器 | `npx vitest run --config vitest.ui.config.mts src/components/modules/DirectorInterpretationVisualEditor.test.tsx` |
| Shooting plan 面板 | `npx vitest run --config vitest.ui.config.mts src/components/modules/DirectorShootingPlanPanel.test.tsx` |
| 类型检查 | `npm run typecheck` |
| 生产构建 | `npm run build` |
| i18n 文案 | `npm run check:colors` 之外，检查 en/zh key 对齐 |

## 标准验收命令

在仓库根目录执行：

```bash
PYTHONPATH=. pytest -q \
  tests/test_director_shooting_plan.py \
  src/apps/test_identity.py \
  src/apps/test_studio_owner_migration.py \
  src/apps/comic_gen/test_identity_middleware.py
```

在 `frontend/` 执行：

```bash
npm run typecheck
npx vitest run --config vitest.ui.config.mts \
  src/components/modules/DirectorInterpretationVisualEditor.test.tsx \
  src/components/modules/DirectorShootingPlanPanel.test.tsx
npm run build
```

仓库级检查：

```bash
git diff --check
```

## 当前通过基线（2026-09-26）

- 后端 Director/身份相关：19 项通过
- Director UI：12 项通过
- 前端 typecheck：通过
- `git diff --check`：通过
- 生产 build：尚未在本轮验收中执行

## 未覆盖风险

1. 生产 build 仍需单独执行；通过 typecheck 不等于 build 一定通过。
2. 真实浏览器中的窄屏、键盘完整流程需要 UI 运行验收。
3. LLM 生成质量不能由 schema 测试证明，只能证明输出契约和边界校验。
4. Storyboard handoff 尚未属于当前验收范围。
5. 远端部署后的 Director UI bundle 需要重新构建后才能验证线上前端行为。

## 部署测试门

只有以下条件全部满足，才允许部署 Director 测试模块：

- 后端验收命令通过；
- Director UI 测试通过；
- typecheck 通过；
- production build 通过；
- `git diff --check` 通过；
- 部署前确认当前 commit 与 GitHub/iframe 测试环境一致；
- HTTPS 冒烟验证：读取 Director plan、保存 draft、确认 revision、读取历史 revision；
- 冒烟验证确认动作没有修改 Storyboard frame 或 Motion task。

## 不在本验收说明中放宽的边界

- 不使用浏览器 Bearer 或 installation ID 作为 workspace 主身份；
- 不把旧 `sample_plan` 自动转成正式 shot plan；
- 不把 beat 数量直接当作镜头数量；
- 不在 Director confirm 中隐式执行 Storyboard handoff；
- 不把来源分块边界声称为精确语义场景边界。
