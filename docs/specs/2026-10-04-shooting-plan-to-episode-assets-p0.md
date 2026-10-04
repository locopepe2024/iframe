# Shooting Plan → Episode Assets P0

状态：当前基线的下一实现切片
日期：2026-10-04

## 已观察到的代码事实

- `DirectorShootingPlan` 已包含 `scene_plan → beat_plan → shot_plan`；
- shot 已包含 `cast_bindings`、`scene_binding` 和 `prop_bindings`；
- Storyboard 已有 plan-to-frame handoff 的独立契约；
- 分集角色、场景和道具仍主要作为普通实体/图片变体读取；
- 资产生成任务目前没有接收结构化的拍摄计划上下文；
- Storyboard 选择资产时还没有根据当前 scene/shot 解析分集视觉变体继承。

## 直接含义

计划到 Assets 的缺口是“上下文投影和消费”缺失，不是重新设计拍摄计划模型。当前 P0 不修改 3D 导演台，也不引入 3D 跨工作流版本化。

## P0 目标

完成：

```text
confirmed DirectorShootingPlan
  → EpisodeVisualContext
  → 分集 Assets 同步差异
  → 用户生成/接受/编辑变体
  → Storyboard 按 scene/shot 选择变体
```

## 场景剧情资产创建与生成入口

- 拍摄计划条目属于特定场景，不追加到基础资产的持久提示词。
- 用户从某条场景约束创建独立的分集资产草稿；草稿记录 `episode_scene_id` 和来源计划版本。参考图由用户在工作台显式选择，不建立自动身份继承关系。
- 封面操作只打开工作台。生成按钮保留在可编辑提示词、参考图和参数旁，点击后直接提交，不增加二次确认。
- 新草稿的生成图先作为候选；只有用户选择候选后才更新该草稿的选中图。基础资产及其选中图不受影响。
- 未知地点 ID 不进入可读描述或生成提示词；可识别的场景资产 ID 显示对应名称。

## 实现切片

### P0.1 EpisodeVisualContext 投影

增加服务端纯函数，从已确认拍摄计划和当前有效实体构建：

- source script revision；
- confirmed Director revision；
- shooting plan revision/hash；
- scene bindings：地点、内外景、时段、季节、天气和 scene asset；
- character bindings：person/character、era、look、continuity；
- prop bindings：关键道具、场景引用和状态；
- shot bindings：表演、构图、灯光、blocking 和来源 IDs。

投影不包含完整 Director JSON，不改变任何资产。

### P0.2 同步差异

增加“从拍摄计划同步 Assets”的管理动作，输出可审阅差异：

- `new_bindings`：计划需要但分集没有的视觉变体/引用；
- `reusable_bindings`：已有变体可复用的场景和镜头；
- `changed_bindings`：时间、地点、服装、道具或连续性发生变化；
- `stale_bindings`：来源计划已变更的旧引用；
- `unresolved_bindings`：角色、场景或道具尚未绑定。

同步不自动生成付费图片，也不覆盖用户已确认的变体。

### P0.3 变体生成输入

用户从差异列表选择生成后，任务使用：

```text
用户显式选择的参考图（可为空）
  + 当前场景的 EpisodeVisualContext
  + 当前 scene/shot 约束
  + 用户编辑内容
```

场景资产草稿保存来源 plan revision/hash 和 scene ID；生成图仅作为待选候选。shot 级引用与审核状态属于后续切片，不由当前生成入口推断。

### P0.4 Storyboard 资产选择

Storyboard 为每个 frame 根据当前 `scene_id`、`shot_id` 选择：

1. 已接受且适用当前场景的分集视觉变体；
2. 已接受的分集定妆基线；
3. 全局底座。

UI 必须显示选择来源和缺失原因，不能把全局底座伪装成场景剧情照。

## 不在 P0

- 3D scene snapshot、camera preset、panorama、depth 和 blocking revision；
- 3D 导演台到 Storyboard 的跨工作流导入；
- 自动生成最终视频；
- 根据图片内容猜测角色层级；
- 自动覆盖用户已确认资产；
- 修改 DirectorInterpretation 或 ShootingPlan 的确认逻辑。

## 验收标准

- 确认拍摄计划后可以看到 Assets 同步差异；
- 差异包含角色、场景、关键道具及其场景/镜头来源；
- 已有可复用变体不会重复生成或复制；
- 生成任务能看到对应的 Script/Director/Shooting Plan 来源；
- Storyboard 能按 scene/shot 选择匹配变体并显示回退层级；
- 拍摄计划修改只标记受影响绑定 stale，不重置整集 Assets；
- 全部功能在没有 3D 导演台引用时仍可完成。

## 验证

- 后端：EpisodeVisualContext 投影、差异计算、变体 lineage 和 stale 规则测试；
- 前端：同步差异、生成入口、资产来源和 Storyboard 选择测试；
- `npm run typecheck`；
- 目标后端测试和生产 build；
- 不运行或依赖 3D 跨工作流版本化测试。
