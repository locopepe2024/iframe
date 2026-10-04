# 拍摄计划、场景分镜与 3D 导演台路线 V1

状态：当前基线上的下一阶段路线
日期：2026-10-04

## 总体目标

在当前 Director/Assets/Storyboard/3D 基线上，建立一个可复核的汇合点：

```text
DirectorShootingPlan
  ├─→ EpisodeVisualContext → 场景视觉变体 → Storyboard
  └─→ 3D Scene Blockout → 机位/全景/深度/人物占位 → Storyboard
```

两条线都服务于分镜。Assets 提供身份、造型和物体参考；3D 导演台提供空间、机位和运动参考；Storyboard 负责把二者与 shot prompt 合成为可生成的镜头描述。

## A 线：拍摄计划到场景分镜

### A1. 拍摄计划确认

输入：已确认的全剧/分集导演理解、剧本来源和用户修改。

输出：版本化 `DirectorShootingPlan`：

- production scenes；
- beats；
- shots；
- 出场人物和人物阶段；
- 关键道具；
- 时间、地点、季节、天气；
- blocking 草稿；
- 镜头语言、时长和连续性。

### A2. 场景/镜头确定性拆分

使用确定性 plan-to-storyboard adapter，将一个确认 shot 映射为一个 Storyboard frame。此阶段不调用 LLM，不生成图片或视频，不重新解释镜头数量。

每个 frame 保留：

- `scene_id`、`beat_id`、`shot_id`；
- shooting plan revision/hash；
- `character_ids`、`prop_ids`、`scene_asset_id`；
- blocking、表演、构图、灯光和声音字段。

### A3. 分集视觉变体同步

从确认的拍摄计划生成 `EpisodeVisualContext`，同步到分集视觉变体索引：

- 已有变体匹配则复用；
- 缺失角色阶段、服装、场景状态或关键道具时创建待生成任务；
- 一次生成的变体允许多个场景和镜头引用；
- 用户可接受、继续编辑、删除或设为当前版本；
- 不覆盖全局角色底座和已确认的其他场景变体。

### A4. 场景分镜资产生成

生成输入按层级组合：

```text
全局角色/场景/道具底座
  + 分集视觉变体
  + 当前 scene context
  + 当前 shot blocking / performance
```

输出是可审核的独立剧照或参考图，不是最终视频。每个输出保存身份、造型、场景上下文、shot 来源和用户审核状态。

### A5. Storyboard 汇合

Storyboard 对每个 shot 选择：

- 场景剧情变体；
- 分集定妆基线；
- 全局底座回退；
- 可选 3D 导演台快照；
- shot prompt 和 blocking。

用户可继续修改或删除 AI 候选。缺少视觉变体时允许保存草稿，但必须显示缺失项，不得伪装成已完成资产。

## B 线：3D 导演台场景与镜头参考

### B1. 场景 Blockout Contract

先定义与资产库和 Storyboard 解耦的场景空间契约：

- 坐标系和单位；
- 场景边界、地面、主要体块和可见区域；
- 预置机位和镜头参数；
- 人物占位点、朝向、身高比例和屏幕方向；
- 道具占位点；
- panorama、depth、camera snapshot 的 revision；
- 导演审核状态和来源。

3D 场景快照引用 `scene_asset_id`，但不改变场景资产的身份描述。

### B2. 预置机位与镜头语言

建立可复用的机位预设：

- 全景、远景、中景、近景、特写；
- 平视、俯视、仰视、过肩和主观视角；
- 静止、推拉、摇移、跟拍和环绕；
- 焦距、视场角、景深和画面比例。

预设只提供导演参考，不自动覆盖拍摄计划中的用户决定。

### B3. 全景与深度

为场景输出：

- 可浏览全景或 360 参考；
- 深度图或深度近似；
- 地面和主要物体的空间关系；
- 可复核的 camera snapshot。

这些输出用于辅助 Storyboard 构图、遮挡、比例和机位判断，不是最终渲染资产。

### B4. 人物占位与视频参考

使用低成本白模或占位人物输出：

- 四人出场顺序；
- 餐厅座位和站位；
- 行走路径、朝向和停留；
- 镜头跟拍、切镜和空间连续性；
- 可选短视频参考。

人物占位不携带真实角色脸、服装或表演身份。真实视觉仍由 Assets 和 Storyboard 负责。

### B5. 3D 结果导入 Storyboard

Storyboard 可引用：

- `scene_snapshot_id`；
- `camera_preset_id`；
- `blocking_revision`；
- panorama/depth media IDs；
- 人物占位视频参考。

如果 3D 参考不存在，Storyboard 继续使用结构化 blocking，但标记 `spatial_review: pending`。

## 汇合顺序

1. 先完成 A2 的 plan-to-storyboard 确定性拆分；
2. 定义 A3 的 EpisodeVisualContext 和分集视觉变体索引；
3. 完成 A4 的场景分镜资产生成与用户审核；
4. 并行定义 B1 的 3D Scene Blockout Contract；
5. 实现 B2/B3 的场景、机位、全景和深度参考；
6. 实现 B4 的人物占位和视频参考；
7. 在 B5 将 3D snapshot 作为可选 Storyboard reference 接入；
8. 最后再评估自动从 3D blocking 生成或修订 shot prompt。

## 不改变的边界

- 3D 导演台不管理 Avatar 身份和角色底座；
- Assets 不决定镜头数量、机位或人物站位；
- Storyboard 不重新解释已经确认的拍摄计划；
- 3D 参考不会自动覆盖用户确认的分镜或资产；
- 用户始终可以接受、修改、删除或继续编辑 AI 候选。

## MVP 验收

- 确认拍摄计划后，可以生成逐 shot 的 Storyboard 草稿；
- 分集 Assets 能显示每个变体适用的场景、风格、道具和表演范围；
- 一个变体可以被多个场景/镜头引用；
- 电影院四人出场和餐厅四人座位能以结构化 blocking 保存；
- 3D 导演台至少能保存一个场景快照、一个机位预设和一组人物占位；
- Storyboard 能同时引用视觉变体和 3D snapshot；
- 缺少 3D 参考时不会阻塞普通分镜草稿，但会明确显示空间审核未完成。
