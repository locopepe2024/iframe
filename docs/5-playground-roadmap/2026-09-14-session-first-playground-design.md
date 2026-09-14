# LumenX Session-first 创作台设计

## 目标

在不替换现有 Playground 模型适配、队列和素材组件的前提下，将“单次生成结果画廊”升级为可持续编辑的 Session 创作历史。

每个 Session 保存独立的当前草稿和生成历史。用户可以：

- 新建并保存多个 Session；
- 点击历史 Session 恢复该创作上下文；
- 在时间线中查看每次提示词、参数、参考素材和生成结果；
- 点击任一历史轮次，将其完整输入恢复到编辑面板；
- 以历史图片或视频为参考素材继续生成；
- 保存新生成与来源轮次之间的父子关系。

## Evidence Boundary

### Code fact

- 当前 `PlaygroundGeneration` 已保存生成所需的模式、模型、提示词、参考素材、参数和输出。
- 当前历史为扁平 `playground_history.json`，不存在 Session 聚合。
- 当前前端已经支持将生成结果放回参考素材输入。

### Direct implication

Phase 1 不需要修改 provider adapter。只需要增加 Session 聚合、生成归属和历史恢复动作，即可复用当前生成链路。

### Not yet proven

- Agent 自动改写提示词和自动选择模型是否提升完成率，尚无运行数据支持。
- 因此 Phase 1 只建立 Agent-like 时间线交互，不引入自动决策或隐式参数修改。

## Domain Model

### PlaygroundSession

```text
id
title
draft
created_at
updated_at
```

`draft` 保存当前未提交或最近使用的：

```text
mode
model_id
prompt
negative_prompt
input_media[]
parameters{}
batch_size
parent_generation_id?
```

### PlaygroundGeneration 增量字段

```text
session_id
parent_generation_id?
```

- `session_id`：生成所属 Session。
- `parent_generation_id`：用户从哪一轮“编辑并继续”；为空表示 Session 根轮次。

## API

```text
GET    /playground/sessions
POST   /playground/sessions
GET    /playground/sessions/{id}
PATCH  /playground/sessions/{id}
GET    /playground/history?session_id={id}
POST   /playground/generate
```

`POST /playground/generate` 接收 `session_id` 和可选 `parent_generation_id`。创建任务时保存完整输入快照，并同步 Session 草稿与更新时间。

## UI Contract

桌面端：

```text
┌──────────────┬──────────────────┬────────────────────────────┐
│ Compose      │ Session history  │ Conversation timeline      │
│ prompt       │ + New Session    │ user request               │
│ references   │ Session A        │ assistant generation       │
│ model/params │ Session B        │ user refinement            │
│ Generate     │ Session C        │ assistant generation       │
└──────────────┴──────────────────┴────────────────────────────┘
```

- Session 列表始终显示清晰的选中态、更新时间和生成轮数。
- 时间线按旧到新排列，避免历史生成倒序造成对话阅读方向混乱。
- 用户输入卡显示提示词、模式、模型和参考素材数量。
- 生成结果紧跟对应用户输入，不拆散到全局画廊。
- “编辑并继续”恢复完整输入快照，不立即生成。
- “作为图片参考”“生成视频”继续复用现有素材动作。
- 运行中、失败和完成状态必须显示在对应轮次内。

窄屏：Session 列表折叠为顶部选择器；编辑面板与时间线允许上下切换，不能产生横向滚动。

## Persistence

- Session 存储：`output/playground_sessions.json`。
- Generation 继续存储在 `output/playground_history.json`。
- 现有无 `session_id` 的历史首次加载时归入一个“历史创作”Session，保留原生成记录。
- Session 草稿采用后端持久化；前端切换 Session 前和编辑停止后更新草稿。

## Phase 1 Success Criteria

1. 空数据首次进入时自动创建一个 Session。
2. 可以创建至少两个 Session，并分别保存草稿与生成历史。
3. 切换 Session 后只显示该 Session 的时间线。
4. 点击历史轮次可以恢复完整输入，不只恢复提示词。
5. 从历史轮次再次生成时保存 `parent_generation_id`。
6. 刷新页面后 Session、草稿、生成历史和进行中任务仍可恢复。
7. 现有图片/视频生成 API、素材上传、收藏和下载行为不回归。

## Phase 1.1 — Global Compose 与全局会话导航

### 目标

在不增加后端 `global` mode、不改变 provider 请求结构的前提下，将图片与视频创作收敛为一个统一的创作入口，并把 Session 导航提升到全局侧栏中“创作台”的二级目录。

### UI Contract

桌面端：

```text
┌────────────────────┬──────────────────────┬────────────────────────────┐
│ Global navigation  │ Global Compose       │ Session timeline           │
│ 工作区             │ 输出：图片 / 视频   │ prompt + parameters        │
│ 资产库             │ 方式：按输出渐进展开 │ generated media            │
│ 创作台             │ prompt + references  │ editable historical turns  │
│   + 新建会话       │ model + parameters   │                            │
│   Session A        │ Generate             │                            │
│   Session B        │                      │                            │
└────────────────────┴──────────────────────┴────────────────────────────┘
```

- “创作台”仍是一级导航；“新建会话”和最近 Session 是其二级导航，不与工作区、资产库、设置同级。
- 现有 Prompt 模板作为跨 Session 复用资源保留，并从“创作台”二级导航进入；模板不归属于某个 Session。
- 现有 Prompt 历史改为“全部历史”，读取未按 `session_id` 过滤的生成记录；当前 Session 的完整历史仍以右侧时间线为唯一主视图。
- 桌面端 Prompt 输入区不重复展示“历史 / 模板”入口；窄屏因全局侧栏隐藏，继续保留这两个快捷入口。
- 图片与视频共享一个 `Global Compose` 容器。第一层只选择输出类型，第二层仅显示该输出类型支持的生成方式。
- 输出类型切换只映射到现有 `t2i / i2i / t2v / i2v / r2v / v2v`，不增加新的 API mode，也不修改模型能力归属。
- Prompt、参考素材和生成方式合并在同一创作上下文中；模型与参数保留为独立设置区，避免一次展开全部复杂参数。
- 主内容区移除桌面 Session 中间栏，只保留 Compose 与当前 Session 时间线。
- 全局侧栏与 Playground 页面必须共享同一个 Session 状态源；切换会话后恢复草稿、加载对应历史并恢复未完成任务轮询。
- 二级导航按钮与 Session 行保持至少 44px 点击高度，并提供明确选中态、键盘焦点和更新时间。
- Session 较多时仅在侧栏内部滚动，不拉长或挤压底部设置入口。

窄屏：全局侧栏不可见时，Session 继续使用顶部选择器；Compose 与时间线上下排列，不产生横向滚动。

### Phase 1.1 Success Criteria

1. 桌面端“创作台”下显示新建会话与 Session 子导航，当前 Session 有明确选中态。
2. Playground 主区域不再出现独立的桌面 Session 中间栏。
3. 图片和视频不再同时以两组大卡呈现；只展开当前输出类型的生成方式。
4. 切换 Session 后草稿、历史和进行中任务恢复行为与 Phase 1 一致。
5. 移动端仍可创建和切换 Session。
6. 现有图片/视频模型、参数、素材输入和生成 API 不发生能力回归。
7. “全部历史”可跨 Session 检索 Prompt，“模板库”可继续保存和套用现有模板，且不与当前 Session 时间线重复。

## Deferred

- 自然语言 Agent 自动拆解任务；
- 多 Session 跨会话素材引用图；
- Session 分支树可视化；
- 多人协作、权限和云同步；
- 自动总结长 Session。
