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

### 2. Director：叙事和镜头规划层

职责：通读剧本并决定“拍什么”和“如何组织镜头”。这是当前工作流缺失的中间层。

输出必须包含：

- `scene_plan[]`：场景边界、时间、地点、人物、情绪、预计时长；
- `beat_plan[]`：场景内动作节拍及其顺序；
- `shot_plan[]`：将多个节拍合并为镜头后的正式镜头计划；
- 每个 shot 的预计时长、切镜理由、景别、机位、构图和运镜；
- 场景连续性：人物朝向、位置、道具状态、光线和时间变化；
- 未确定信息和导演假设，分别标记为 `unresolved` 和 `hypothesis`。

核心规则：

1. 一个 shot 可以包含多个连续动作节拍。
2. 动作节拍不自动生成 shot。
3. 只有景别、机位、空间关系、叙事重点或时间连续性发生明确变化时才切镜。
4. 同一连续动作默认优先保留在同一镜头内。
5. 任何镜头总时长必须与场景时长和动作节奏相容。

建议结构：

```json
{
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

### 3. Assets：导演约束下的视觉资产层

职责：把 Script 中的实体转成可复用的视觉资产，并保留 Director 对它们的约束。

角色资产必须包含：

- 稳定身份：姓名、年龄阶段、身份；
- 视觉锚点：脸型、发型、体型、显著特征；
- 时期/身份/服装变体；
- 导演确认的表演边界：可表达的情绪、姿态倾向、关系状态；
- 不同场景下的可见状态，不把一次性动作写进长期角色外观；
- `director_profile_revision` 和来源 `source_refs`。

场景资产必须包含：

- 地点、时间和内外景；
- 固定空间结构和关键布景；
- 可复用光线/色彩基线；
- 导演指定的连续性约束。

道具资产必须包含：

- 外观和材质；
- 可见状态；
- 与剧情事件相关的状态变化；
- 不把动作本身误写成道具固有属性。

禁止：Assets 自行决定镜头数量、镜头时长或运镜。Assets 只能提供可被镜头引用的视觉事实和约束。

### 4. Storyboard：正式镜头描述层

输入只能是：

- 已确认的 `shot_plan`；
- 对应 Director 约束；
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
- `shot_plan_id`、`director_profile_revision`、`source_refs`。

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
director_planning
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
2. 重新运行 Director，生成场景计划、动作节拍计划和 shot plan；
3. 将旧 frame 映射到 `beat_id`，不得自动等同于 `shot_id`；
4. 合并同一连续镜头内的动作；
5. 由 Storyboard 阶段重新生成完整镜头描述；
6. 只有 `storyboard_validated` 的镜头才创建首帧或 motion 任务。

## 成功标准

- Director 能输出独立的场景计划和 shot plan；
- 一个 shot 可以承载多个动作节拍；
- 158 条旧记录经过审计后能区分“保留、合并、重复、缺失”；
- StoryboardFrame 数量等于确认后的 shot plan 数量；
- Motion 任务数量只由已确认且通过校验的 storyboard 镜头决定；
- Assets 中的角色和场景定义包含 Director 约束、时期变体和来源，而不只是名称/描述抽取。
