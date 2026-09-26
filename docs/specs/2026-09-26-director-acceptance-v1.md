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

## 本轮能力验收基线（用户确认）

Director 只有同时满足以下五项，才算达到可测试能力：

1. **导演风格**：可以新增/编辑导演风格，并明确项目或系列作用域、保存状态和当前生效版本。
2. **可视化导演分析**：人物关系、时间线、事件和场景都能以结构化数据驱动的视图展示；图、时间线和表单读写同一份草稿。
3. **导演重分析**：可以基于当前剧本/事实版本重新分析；重分析进入新草稿，不覆盖已确认版本；旧结果可追溯并标记 stale。
4. **分析标注修改**：用户可以对事件、场景、beat、shot 添加或修改导演意图，例如某一镜头的表演效果、画面效果、声音、剪辑或连续性要求；修改可保存、恢复并参与确认校验。
5. **确认后的全局生效**：确认的 Director revision 必须成为分镜分析及其后续生成链的明确输入，并在请求 lineage 中携带 revision/hash；未确认草稿不得影响全局。

“界面上存在按钮”不等于通过验收；每项都必须有状态、持久化、revision/stale 和下游消费证据。

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

### E. 本轮五项能力验收矩阵

| 能力 | 必须验证的行为 | 当前证据/缺口 |
| --- | --- | --- |
| 导演风格 | 新增/编辑风格；项目/系列作用域；保存后重新打开仍能恢复；显示当前生效版本 | Code fact：已有 `art_direction` 保存与继承；需补“新增导演风格”独立验收，避免与视觉风格预设混称 |
| 可视化分析 | 人物关系、时间线、事件、场景均可查看和编辑；视图间修改同步；场景不能只存在于 shooting plan 的 JSON | Code fact：story map 已覆盖 people/phases/events/relationship arcs；需补 scene 视图和端到端交互测试 |
| 重分析 | source/fact revision 变化可触发重分析；结果进 draft；确认 revision 不被静默改写；失败和取消可重试 | Code fact：profile analysis/refine job 和 draft revision 存在；需补“确认版本保留 + 重分析 stale”测试 |
| 标注修改 | 至少覆盖 shot 的 `visual_intent`、表演/动作效果、lighting、sound、transition/continuity；保存后再读一致；缺字段阻止确认 | Code fact：shooting plan 有部分视觉字段；缺口是独立的用户标注语义、编辑入口和 round-trip 测试 |
| 全局生效 | Director confirm 后 storyboard analysis 请求包含确认 profile revision/hash 和执行摘要；草稿不能被消费；旧 storyboard/frame 标记 review/stale | Code fact：Storyboard analysis 已消费 effective director profile；需补 revision/hash 断言、旧 frame review 门和“确认前不生效”测试 |

### F. 必须补齐的遗漏边界

1. **导演风格 ≠ 视觉风格预设**：验收要区分导演的叙事/摄影/表演约束与 `art_direction.style_config` 的视觉参数，并定义两者合并优先级。
2. **场景视图缺失**：当前 story map 主要是 phase/event；拍摄计划有 scene，但尚未证明“场景分析”是可视化、可编辑且与事件/shot 有稳定引用。
3. **标注的对象和作用域**：必须规定标注属于 event、scene、beat 还是 shot；同一标注如何进入 storyboard prompt，不能只保存为任意 JSON。
4. **重分析的输入快照**：必须固定 source revision、Fact Ledger revision、导演风格 revision 和分析指令，否则无法判断重分析是否可复现。
5. **全局生效的下游范围**：至少验收 storyboard analysis、frame generation、资产/视频 prompt；只证明一次 storyboard 分析读取 profile，不足以声称全局生效。
6. **确认边界**：Director interpretation confirm、shooting plan confirm、Storyboard apply/confirm 仍是三个动作；验收必须防止任一按钮隐式替代另一个动作。
7. **失败/回滚**：重分析失败、保存冲突、确认冲突和下游 lineage stale 都要保留旧确认版本，并给出恢复路径。

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

- Director 后端/profile/shooting/storyboard 相关：72 项通过
- Director UI：12 项通过
- 前端 typecheck：通过
- `git diff --check`：通过
- 前端 production build：通过

## 未覆盖风险

1. 真实浏览器中的窄屏、键盘完整流程需要 UI 运行验收。
2. LLM 生成质量不能由 schema 测试证明，只能证明输出契约和边界校验。
3. Storyboard handoff 尚未属于当前验收范围。
4. 远端部署后的 Director UI bundle 需要 HTTPS 冒烟验证线上前端行为。

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
