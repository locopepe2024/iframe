# 3D 导演台动作重定向实施交接 v1

## 目的

将复刻系统输出的 `motion-track.v1` / `full_motion bundle` 应用到 Blender 角色 rig，生成可检查、可编辑、可导出的白模动作参考。

本规格交给 3D 导演台实施。复刻系统负责提供源视频动作数据；3D 导演台负责角色骨骼重定向、IK、脚部接触、动作清理和预览输出。

## Observed

- 当前测试 rig：`white-model-neutral-female-v1.blend`。
- 当前 rig 包含：
  - `pelvis`
  - `spine_lower`, `spine_mid`, `spine_chest`
  - `upper_leg_l/r`, `lower_leg_l/r`
  - `ankle_l/r`, `foot_l/r`
  - `DEF_foot_l/r`
  - `toe_l/r`, `toe_attachment_l/r`
- `lower_leg_l/r`、`DEF_foot_l/r`、`toe_l/r`、`toe_attachment_l/r` 是变形骨骼。
- `ankle_l/r`、`foot_l/r` 是非变形辅助关节。
- 当前 rig 没有现成 IK 约束：`IK_COUNT=0`。
- 复刻轨迹现在可以输出：
  - `body_centers.hips`
  - `pelvis` / `spine_*` 旋转字段
  - `semantic_joints`
  - `joint_confidence`
  - `foot_targets.left/right.ankle|heel|toe`
  - `foot_contact_candidates`

## Direct implication

3D 导演台不能只读取 `joint_rotations_deg`。必须优先消费语义关节、脚部目标和置信度，再根据目标 rig 的 rest pose 计算局部旋转。

```text
motion-track.v1
  → source semantic joints
  → target rig rest-pose calibration
  → local quaternion retarget
  → pelvis/spine/limb solve
  → optional foot IK
  → cleanup and review
  → white-model video / full_motion bundle
```

## 输入契约

每个动作采样至少应支持：

```json
{
  "frame": 1,
  "source_frame": 1,
  "source_timestamp_seconds": 0.0,
  "selection_status": "tracked",
  "root_position": [0.0, 0.0, 0.0],
  "semantic_joints": {
    "left_hip": [x, y, z],
    "right_hip": [x, y, z],
    "left_knee": [x, y, z],
    "right_knee": [x, y, z],
    "left_ankle": [x, y, z],
    "right_ankle": [x, y, z],
    "left_heel": [x, y, z],
    "right_heel": [x, y, z],
    "left_foot_index": [x, y, z],
    "right_foot_index": [x, y, z]
  },
  "joint_confidence": {
    "left_ankle": 0.0,
    "right_ankle": 0.0,
    "left_heel": 0.0,
    "right_heel": 0.0,
    "left_foot_index": 0.0,
    "right_foot_index": 0.0
  },
  "foot_targets": {
    "left": {"ankle": [x, y, z], "heel": [x, y, z], "toe": [x, y, z]},
    "right": {"ankle": [x, y, z], "heel": [x, y, z], "toe": [x, y, z]}
  },
  "foot_contact_candidates": {
    "left": {"candidate": false, "confidence": 0.0},
    "right": {"candidate": false, "confidence": 0.0}
  }
}
```

坐标必须从 manifest 读取，不能根据字段名称猜测：

```json
"coordinate_system": {
  "image_x": "blender_x",
  "image_y": "blender_z",
  "depth_z": "blender_y"
}
```

## 目标 rig 映射

第一版至少支持以下语义映射：

| Semantic joint/segment | Target rig | 处理方式 |
|---|---|---|
| pelvis | `pelvis` | 局部 quaternion，保留 root 平移分离 |
| torso | `spine_lower`, `spine_mid`, `spine_chest` | 按 rest pose 分摊躯干旋转 |
| upper leg L/R | `upper_leg_l/r` | 由 hip → knee 向量计算 |
| lower leg L/R | `lower_leg_l/r` | 由 knee → ankle 向量计算 |
| ankle L/R | `ankle_l/r` | 直接关节姿态或 IK 链末端 |
| foot L/R | `foot_l/r` | heel → toe 方向 |
| toe L/R | `toe_l/r` | foot → toe 方向 |
| toe attachment L/R | `toe_attachment_l/r` | 跟随 toe，必要时按比例分摊 |

不要将所有关节统一写到 Blender Y 轴。目标骨骼的 rest-pose 局部轴必须参与计算。

## 重定向算法

### 第一阶段：局部 quaternion

对每根骨骼：

1. 读取目标骨骼 rest-pose 方向向量。
2. 从源语义关节计算当前方向向量。
3. 在父骨骼 rest frame 中计算：

```text
delta = rotation_between(rest_direction, source_direction)
```

4. 将 `delta` 应用到目标骨骼的局部 rest rotation。
5. 对 quaternion 做符号连续化，避免相邻帧翻转。

### 第二阶段：root 与 pelvis 分离

- `root_position` 用于角色整体移动。
- pelvis 旋转只来自左右髋和躯干关系。
- 不要把人物横向画面移动全部当成角色身体位移。
- 如果启用了相机运动修正，必须在 manifest 中记录修正来源。

### 第三阶段：脚部接触

`foot_contact_candidates` 只能作为候选输入。

只有满足以下条件才允许进入 IK 锁定：

- 左右脚相关点均有足够置信度；
- 候选状态连续至少 3 帧；
- 脚目标的速度和高度变化在阈值内；
- 地面平面已经标定；
- IK 解算后膝盖方向没有翻转；
- 解算残差低于阈值。

IK 失败时必须保留原始 quaternion 结果并记录：

```json
{
  "ik_status": "rejected",
  "reason": "residual_above_threshold"
}
```

## 动作清理

至少提供以下可开关处理器：

- 短缺口插值；
- 单帧异常检测；
- quaternion 连续化；
- 躯干曲线平滑；
- 肩膀和肢体扭转限制；
- 膝盖方向稳定；
- 脚部接触候选过滤；
- 相机运动引起的 root 滑移修正。

所有清理步骤必须记录版本和参数，不能静默覆盖源轨迹。

## 输出契约

3D 导演台至少输出：

```text
white_model_video.mp4
white_model_preview.png
full_motion.bundle.json
retarget_manifest.json
```

manifest 至少记录：

```json
{
  "schema": "director-full-motion-bundle.v1",
  "source_track_revision": "...",
  "rig_asset": "white-model-neutral-female-v1.blend",
  "rig_mapping_revision": "...",
  "retarget_mode": "local_quaternion_v1",
  "ik_enabled": false,
  "cleanup_processors": [],
  "frame_range": [1, 187],
  "fps": 24,
  "coordinate_system": {},
  "warnings": [],
  "review_status": "needs_director_review"
}
```

## 验收标准

### 结构验收

- 髋点存在时，`pelvis` 和脊柱链有输出；
- 脚点存在时，`foot_targets` 有左右两侧数据；
- 脚点缺失时，不伪造脚部目标；
- 每个 IK 结果有 accepted/rejected 状态；
- 输出可以被 Blender 再次打开并重新渲染。

### 视觉验收

在源视频开始、中间、结束和至少两个舞蹈关键帧检查：

- 髋部是否跟随源动作摆动；
- 脊柱是否与髋部和肩部连续；
- 膝盖方向是否正确；
- 脚部是否出现明显漂移；
- 脚部接触时是否穿地；
- 角色整体移动是否与镜头运动区分；
- 左右人物是否没有被错误合并。

### 性能验收

- 先提供 640×360 低采样预览；
- 7.79 秒素材应能在 media 主机完成完整渲染；
- 失败时保留日志和中间状态，不产生损坏 MP4。

## 边界

- 本规格不要求 3D 导演台调用 H3、Seedance 或 Wan。
- 本规格不把 Qwen 输出当作三维坐标真值。
- 本规格不要求复刻 worker 直接操作 Blender rig。
- provider 的 pose/depth/ControlNet 能力仍以 catalog 明确声明为准。
- `foot_contact_candidates` 不是已经确认的地面接触事实。

## 建议实施顺序

1. 导入并显示 `semantic_joints`、`foot_targets` 和置信度。
2. 建立 rig rest-pose mapping manifest。
3. 实现 pelvis/spine/limb 局部 quaternion 重定向。
4. 输出白模预览并做关键帧检查。
5. 增加脚部接触候选可视化。
6. 增加 IK target/pole target 和失败回退。
7. 输出 `full_motion.bundle.json`、白模视频和可编辑 Blender 动画。

## Implementation status

### Phase 1 — completed by 3D Director

Commit: `840f79dc feat(director3d): import motion-track v1 evidence`

Completed:

- strict `motion-track.v1` JSON contract parsing;
- coordinate-system declaration validation;
- read-only import of `semantic_joints`, confidence, `foot_targets`, and contact candidates;
- motion-track panel in the 3D Director UI;
- explicit handling for missing foot points without fabricating targets;
- typecheck and two motion-track contract tests.

Phase 1 deliberately does not write pose, bone rotations, root transforms, or IK state. The imported track remains evidence until a director explicitly starts a retarget run.

### Phase 2 — next handoff

Implement `local_quaternion_v1` as a separate, reviewable operation:

1. Build and persist a rig rest-pose mapping manifest.
2. Convert source semantic segment vectors into the target parent rest frame.
3. Compute local quaternion deltas with sign continuity.
4. Solve pelvis and spine before limbs, then evaluate the armature.
5. Store per-frame residuals and rejected joints without mutating the source track.
6. Export a low-resolution preview and a retarget manifest before enabling IK.

Phase 2 success requires a visual preview plus numeric checks for pelvis, spine, knee, ankle, and quaternion continuity. IK, foot locking, cleanup, and `full_motion.bundle.json` remain later phases.
