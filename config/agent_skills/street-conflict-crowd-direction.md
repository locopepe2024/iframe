---
name: street-conflict-crowd-direction
description: 设计街道抢劫、斗殴、追逐和救援场景中的空间轴线、近中远景人群反应与信息差；用于场景到分镜的群像动作编排，不代替具体武打招式或角色设计。
---

# 街道冲突与群像动作

将 ScreenWeaver 战场设计中“先交代空间、保持轴线、用固定锚点、按距离分配反应”的方法用于街道冲突。适用于粮铺打劫、街头斗殴、追逐、救援和主角介入群体事件。

## 工作边界

- 场景设计提供地点、区域、连接关系、可见关系、固定地标和世界光影。
- 人物层级 Skill 提供主演、配角、固定群演和匿名人群的身份粒度。
- 本 Skill 提供冲突区域、行动轴线、信息获得范围、近中远景行为和反应传播。
- 分镜 Skill 将结果编译成具体镜头、时间轴和构图。
- 动作物理或武打 Skill 负责接触、受力、招式和武器细节；本 Skill 不替它发明招式。

## 必须先建立的空间合同

输出或检查以下字段：

```text
street_conflict_map:
  location_id
  active_zone
  foreground_zone
  midground_zone
  background_zone
  subject_positions
  action_axis
  camera_side
  escape_routes
  visible_connections
  occlusion_rules
```

- 先写冲突发生在哪里、双方位于哪一侧、主体朝哪个方向行动。
- 多个同名街角不能仅凭“街角”合并；以固定地标、人物连续出现和空间指代核对是否同址。
- “阁楼能看见粮铺”与“粮铺能看见阁楼”分别记录观察方向；不得从单向视线自动推断另一方向。
- 保持 180 度轴线和人物左右关系，除非镜头明确越轴或切换视点。
- 远景、阁楼或遮挡区域只描述当前视点能够看见的内容。

## 人群信息差

人群的反应取决于是否看见并理解冲突，不是所有人同步反应。

```text
foreground:
  awareness: clear
  behavior: conflict_action_or_immediate_reaction

midground:
  awareness: sees_and_understands
  behavior: staggered_avoidance_or_cautious_observation

background:
  awareness: unaware_or_uncertain
  behavior: continue_existing_route
```

### 近景

- 只放需要清晰表现的冲突主体、受力、武器和道具。
- 近景动作应有明确起点、触发关系和停止状态。
- 不把整条街的人都提升为清晰前景角色。

### 中景

- 中景路人可停步、后缩、低头绕行、拉同伴退开、回头后避让。
- 反应应错峰发生，方向通常远离冲突区域。
- 中景路人不抢主角动作，不突然加入战斗，除非剧本明确授权。

### 远景

- 远景行人只维持街道原有流动、密度和方向。
- 没有足够视线或信息时，不突然集体逃跑、围观或停滞。
- 远景人物可以只表现为轮廓、色块和运动轨迹，不承诺固定面孔。

## 反应传播规则

```text
source: visible_conflict
foreground: immediate
midground: delayed_and_selective
background: none_or_minimal
direction: away_from_active_zone
```

写作时说明：谁先看见、谁随后反应、谁仍未察觉，以及反应向哪里移动。不得把“人群害怕”写成没有主体、没有方向的集体情绪。

## 分镜编排顺序

按以下顺序组织每个镜头或连续镜头：

1. 起幅交代冲突区域、主体位置和行动轴线；
2. 近景主体触发事件；
3. 中景可见人群在不同时间点产生避让或观察；
4. 远景维持不知情的正常活动；
5. 在镜头结束处保存新的空间状态、人物位置和人群流向。

使用 3–6 个连续时间段；动作时间必须服从镜头总时长。一个镜头不应同时塞入完整战斗、全街反应和新的地点转换；超出可读范围时拆镜头。

## 三个典型模式

### 粮铺打劫

- 近景：匪寇围堵粮铺，老掌柜或柜台承担主要事件。
- 中景：看见打劫的路人停步、后缩、低头绕行或贴墙避让。
- 远景：继续沿长街行走，不表现明显反应。

### 主角街头交手

- 近景：两名主角完成招式、兵器和视线变化。
- 中景：百姓扩大安全距离，保持观察或避让。
- 远景：街道仍有零散通行，不把城市活动全部冻结。

### 卖艺少女街角

- 近景：打手、少女和卖艺道具形成冲突核心。
- 中景：路人发现欺凌后停步、绕行或拉同伴离开。
- 远景：不知情者继续经过；主角介入后，反应只向可见区域逐步扩大。

## 输出合同

至少输出：

```text
conflict_zone
action_axis
camera_side
foreground_subjects
midground_crowd_behavior
background_crowd_behavior
awareness_propagation
visibility_and_occlusion
end_state
uncertainties
```

所有补充内容标记为 `authored` 或 `inferred`。结构化合同证明了提交意图，不保证视频模型一定正确生成；应通过成片逐帧检查近中远景反应、轴线和空间关系。
