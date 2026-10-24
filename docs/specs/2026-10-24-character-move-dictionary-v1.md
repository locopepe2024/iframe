# 主角招式说明词典与镜头调用合同 v1

日期：2026-10-24。状态：设计合同；本轮只定义数据边界和调用方式，尚未接入角色台、素材库或 Shot Design UI。

## 目标

为已确认角色建立可复用的战斗方式和招式说明，使每个镜头都能引用一致的发力逻辑、持械关系和动作外观。招式词典属于 `character.performance`，不修改角色身份、服装、场景或光影。

## 分层

### 1. 战斗方式档案 `combat_profile`

角色长期稳定的动作逻辑：

- 体系或训练方向（可为空）；
- 常用距离：远距、 中距、近身；
- 主导侧与持械手；
- 身体发力链：脚、膝、髋、躯干、肩、肘、腕；
- 防守和恢复习惯；
- 兵器在镜头中的占用关系；
- 不能自动改变的行为约束。

例如“右手持剑，左手保持护身或平衡；攻击由脚步和髋部带动；不在每次攻击后回到标准站姿”。这些是风格和连续性约束，不是当前镜头已经发生的动作。

### 2. 单招条目 `move`

每个招式至少包含：

```json
{
  "move_id": "suyan.sword.disarm_sweep.v1",
  "character_id": "suyan",
  "label": "连贯剑势·拨械",
  "category": "sword_disarm",
  "combat_profile_ref": "suyan.swordfighter.v1",
  "starting_state": {
    "distance": "中距",
    "weapon_hand": "右手",
    "guard": "剑身位于身体前侧"
  },
  "body_mechanics": ["前脚切入", "髋部带动躯干旋转", "肩肘带动剑臂", "腕部完成刃线调整"],
  "weapon_trajectory": "从身体前侧横向扫过对手持械手的外侧",
  "target_relation": "对手持械手或刀剑，不默认攻击身体",
  "contact_result": "刀剑被精准撞开并脱手；是否飞出画面由当前镜头决定",
  "recovery_state": "剑势完成后保持面向对手，不自动转身",
  "visible_cues": ["剑刃轨迹清楚", "持械手被迫张开", "重心沿横扫方向转移"],
  "forbidden_interpretations": ["不改为刺击", "不自动增加第二次斩击", "不自动造成身体伤口"],
  "source_refs": [],
  "status": "draft"
}
```

`contact_result` 描述招式的典型结果；只有当前剧本、动作合同或用户明确授权时，才把兵刃脱手、受伤、破坏道具等结果写入本镜。

### 3. 连招模块 `combination`

连招只保存已确认的动作关系，不把每个镜头固定成同一套动作：

- `entry_move`：进入动作；
- `contact_order`：接触顺序；
- `transition_rules`：哪些动作可以无停顿衔接；
- `single_contact_constraints`：同一目标是否只允许一次接触；
- `exit_state`：收势或下一镜交接状态；
- `duration_guidance`：建议时间范围，而非模型保证；
- `reference_media`：动作、节奏或兵器轨迹的用途标记。

## Shot Design 调用

镜头只引用当前需要的条目：

```json
{
  "move_ref": "suyan.sword.disarm_sweep.v1",
  "variant": "面对三名匪寇的连续拨械",
  "target_ids": ["bandit_1", "bandit_2", "bandit_3"],
  "authorized_result": "数件兵刃脱手",
  "duration_seconds": 2.0,
  "timing": "待节奏 Skill 设计",
  "source_revision": "move_revision_pending"
}
```

调用流程是：

`角色战斗方式 → 选择单招 → 选择招式变体 → 普通动作合同 → 镜内节奏表 → H3/Seedance 编译`

H3 提示词只展开当前招式的可见动作，不提交整套词典。招式名称不能代替身体路径、接触结果或终止状态。

## 素材职责

招式可绑定图片或视频，但必须逐项声明用途：

- 图片：`pose`、`weapon`、`guard`、`keyframe`；
- 视频：`action_choreography`、`rhythm`、`impact_timing`、`weapon_trajectory`、`camera_movement`。

选择视频的 `rhythm` 不会自动带入视频人物、服装、场景、对白或灯光。未逐帧核对的视频时间只能作为参考节奏，不能标为实测接触时间。

## 版本与确认

- 招式词典有独立 `revision` 和 `status`：`draft`、`reviewed`、`active`、`retired`；
- 角色身份或服装变更不会自动改写招式，但应提示复核持械和可见动作；
- 招式条目修改后，已引用它的镜头候选和 H3 预览标记待审；已生成视频不回写；
- 用户只采纳招式时，不改变景别、机位、运镜、光线、场景和其他角色；
- 词典候选、镜头引用和最终提示词分别保存来源，不能把完整提示词当成词典事实。

## 验收边界

1. 同一角色选择同一招式，在不同镜头中保持持械手、发力链和招式结果逻辑。
2. 删除招式引用后，H3 输入不再出现该招式的动作约束。
3. 只引用动作视频的节奏时，不出现视频人物身份或场景描述。
4. 招式没有授权身体命中时，不自动生成受伤或击飞。
5. 招式建议时间与成片逐帧时间分开记录。
6. 旧招式修订后，旧镜头预览失效，新生成任务保留原快照。

## 尚未实现

当前代码已有 `character.performance` 词典领域和 `shot-martial-choreography` Skill，但没有角色招式条目、连招模块、镜头 `move_ref` 或素材用途字段。本合同不声称这些能力已经可在 UI 中使用。
