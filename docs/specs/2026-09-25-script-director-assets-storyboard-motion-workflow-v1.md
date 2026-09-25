# Script → Director → Assets → Storyboard → Motion 工作流 v1

## 目的

把剧本生产链拆成五个有明确事实边界的阶段：

```text
Script → Director → Assets → Storyboard → Motion
```

`StoryboardFrame` 不再由动作条目数量直接决定。镜头数量必须来自导演阶段的镜头规划；动作节拍只能作为镜头内的表演顺序。

## 证据和当前缺口

- **代码事实**：当前 storyboard prompt 要求“一行包含多个动作时，拆为多帧”，并由模型返回的每个 `frame` 直接转换为 `StoryboardFrame`。
- **代码事实**：长剧本按约 1600–1800 字分批调用模型，结果通过 `frames.extend(batch_frames)` 合并，没有镜头合并器或重复检测。
- **代码事实**：当前 Director Profile 作为上下文传给 storyboard，但没有单独的场景计划和镜头计划输出。
- **代码事实**：当前 Assets 阶段提取 characters/scenes/props，角色主要是实体、外观和服装记录，不承担镜头中的导演化表演定义。
- **直接推论**：当前 frame 数量可能是动作节拍数，不足以证明是有效镜头数。
- **待验证**：第一集的 158 条中有多少是动作节拍、重复项或可合并镜头，需要用原始 draft 做审计。

## 阶段边界

### 1. Script：原文事实层

职责：保存和定位原始剧本事实。

输出：

- 原文及来源范围 `source_ref`；
- 场景标题、时间、地点、内外景；
- 对白、说话人；
- 动作段落和事件顺序；
- 原文中明确出现的角色、时期、服装、道具和关系。

禁止：补写未出现的外观、情绪、动机、灯光或镜头。

### 2. Director：剧本阐释与拍摄规划层

职责：在 Script 提供的事实账本上，先决定“这个故事如何理解、要引导观众经历什么”，再决定“如何拆场和组织镜头”。Director 不是从剧本直接跳到 shot list，而是两个先后衔接、分别可审阅和版本化的产物。

#### DirectorInterpretation：导演阐释

回答“这故事讲什么，导演打算怎样引导观众理解和感受”。至少包含：

- 核心主题、戏剧主线、叙事重点和希望观众带走的感受；
- 人物目标、人物弧光、关系变化与冲突结构；
- 全片/全集情绪曲线、关键转折及并行时间线；
- 线索线、反复意象及其铺设、揭示、回收位置；
- 要突出、压低、延迟揭示或保留暧昧的剧情信息及理由；
- 整体风格，以及表演、视听、节奏和剪辑原则；
- ScriptFactLedger 来源、导演解释、假设和待用户决策项。

ScriptFactLedger 由 Script 阶段维护。Director 可以判断事实的戏剧意义，但不能把解释或假设写回为原文事实。

#### DirectorShootingPlan：拍摄计划

用户审阅并批准导演阐释后，再将创作判断落实为拍摄拆解：

- `scene_plan[]`：场景边界、时间、地点、人物、戏剧目的、情绪和预计时长；
- `beat_plan[]`：场景内动作/戏剧节拍及顺序；
- `shot_plan[]`：将一个或多个节拍组合成正式镜头；
- 每个 shot 的时长、切镜理由、景别、机位、构图和运镜；
- 场景连续性：人物位置/朝向、道具状态、光线和时间变化；
- 对已批准 `DirectorInterpretation` revision 的引用，以及未决项/假设标记。

核心规则：

1. 一个 shot 可以包含多个连续动作节拍。
2. 动作节拍不自动生成 shot。
3. 只有景别、机位、空间关系、叙事重点或时间连续性发生明确变化时才切镜。
4. 同一连续动作默认优先保留在同一镜头内。
5. 任何镜头总时长必须与场景时长和动作节奏相容。

建议结构：

```json
{
  "interpretation_ref": "director-interpretation-rev-1",
  "scene_plan": [{
    "scene_id": "scene-01",
    "source_refs": ["source:chars-0-420"],
    "location": "电影院入口",
    "time": "傍晚",
    "duration_seconds": 8,
    "continuity_in": "两人从街道方向走来",
    "continuity_out": "两人进入入口"
  }],
  "beat_plan": [{
    "scene_id": "scene-01",
    "beat_id": "beat-01",
    "description": "周涵牵着沈夏走向入口",
    "duration_seconds": 6,
    "keep_with_next": true
  }],
  "shot_plan": [{
    "shot_id": "shot-01",
    "scene_id": "scene-01",
    "beat_ids": ["beat-01"],
    "duration_seconds": 6,
    "shot_size": "全景",
    "camera_angle": "平视",
    "composition": "入口位于画面右侧，两人从左侧进入",
    "camera_movement": "缓慢侧后方跟拍",
    "cut_reason": null
  }]
}
```

#### 人机审阅门

1. 用户校对/批准 ScriptFactLedger，解决事实抽取错误和来源冲突。
2. 用户审阅/修改/批准 DirectorInterpretation，确认导演如何理解人物、冲突、情感、线索和剧情重点。
3. 用户审阅/修改/批准 DirectorShootingPlan，确认划场、beat-to-shot 组合、镜头数与时长。

保存草稿不等于批准生效。下游产物必须引用确切的已批准版本；上游修订只标记受影响的下游版本过期，由用户决定局部返修或重做。

### 3. Assets：导演约束下的视觉资产层

职责：把 Script 中的实体转成可复用的视觉资产，并保留 Director 对它们的约束。

角色资产必须包含：

- 稳定身份：姓名、年龄阶段、身份；
- 视觉锚点：脸型、发型、体型、显著特征；
- 时期/身份/服装变体；
- 导演确认的表演边界：可表达的情绪、姿态倾向、关系状态；
- 不同场景下的可见状态，不把一次性动作写进长期角色外观；
- `director_interpretation_revision`、`director_shooting_plan_revision` 和来源 `source_refs`。

场景资产必须包含：

- 地点、时间和内外景；
- 固定空间结构和关键布景；
- 可复用光线/色彩基线；
- 导演指定的连续性约束。
- 对应的 `DirectorInterpretation` 和 `DirectorShootingPlan` revisions，保证资产定义能追溯其戏剧用途、人物阶段和场景规划。

道具资产必须包含：

- 外观和材质；
- 可见状态；
- 与剧情事件相关的状态变化；
- 不把动作本身误写成道具固有属性。

禁止：Assets 自行决定镜头数量、镜头时长或运镜。Assets 只能提供可被镜头引用的视觉事实和约束。

### 4. Storyboard：正式镜头描述层

输入只能是：

- 已确认的 `shot_plan`；
- 对应已批准的 `DirectorInterpretation` 和 `DirectorShootingPlan`；
- 对应 Assets 及其时期变体；
- 原文对白和环境音事实。

每个 `StoryboardFrame` 必须一一对应一个 `shot_plan.shot_id`，并完整填写：

- 场景、时间、环境氛围；
- 角色及正确时期变体；
- 角色表演：表情、视线、姿态、步伐、互动；
- 动作物理：接触、受力、材质、运动轨迹；
- 光影：光源方向、冷暖色、明暗关系；
- 构图：景别、机位、画面位置；
- 运镜：类型、方向、速度；
- 时长、对白、说话人、环境音；
- `shot_plan_id`、`director_interpretation_revision`、`director_shooting_plan_revision`、`source_refs`。

Storyboard 可以扩写描述，但不能新增 Script 未支持且 Director 未标记为假设的剧情事实。

### 5. Motion：执行层

职责：把已确认的 Storyboard 镜头转成视频执行任务。

输入：

- 一个已通过完整契约的 StoryboardFrame；
- 首帧资产或角色/场景参考资产；
- Motion 描述：角色动作、物体运动、摄像机运动、速度和转场；
- 执行模式：`t2i_i2v` 或 `direct_r2v`。

禁止：Motion 阶段重新决定场景、角色身份、景别或镜头数量。若需要改变这些内容，必须回到 Director 或 Storyboard 阶段。

## 任务状态

建议使用以下状态，避免把 frame 数量误当作 motion 任务数量：

```text
script_ready
script_facts_review
director_interpretation_draft
director_interpretation_review
director_interpretation_approved
director_shooting_plan_draft
director_shooting_plan_review
director_ready
assets_planning
assets_ready
shot_planning
storyboard_writing
storyboard_validated
awaiting_first_frame
awaiting_motion
motion_running
completed
failed
```

## 第一集迁移规则

现有 158 条记录不能直接视为已确认镜头。迁移时应：

1. 保留原始文本和旧 frame 作为审计输入；
2. 重新运行 Director：先生成并审阅导演阐释，再生成场景计划、动作节拍计划和 shot plan；
3. 将旧 frame 映射到 `beat_id`，不得自动等同于 `shot_id`；
4. 合并同一连续镜头内的动作；
5. 由 Storyboard 阶段重新生成完整镜头描述；
6. 只有 `storyboard_validated` 的镜头才创建首帧或 motion 任务。

## 成功标准

- Director 能输出可审阅的阐释（主题、人物、冲突、情绪、时间线/线索线、风格和剧情重点）及独立的场景/beat/shot plan；
- ScriptFactLedger、DirectorInterpretation、DirectorShootingPlan 可分别修订、批准，并保留明确的来源和依赖版本；
- 一个 shot 可以承载多个动作节拍；
- 158 条旧记录经过审计后能区分“保留、合并、重复、缺失”；
- StoryboardFrame 数量等于确认后的 shot plan 数量；
- Motion 任务数量只由已确认且通过校验的 storyboard 镜头决定；
- Assets 中的角色和场景定义包含 Director 约束、时期变体和来源，而不只是名称/描述抽取。
