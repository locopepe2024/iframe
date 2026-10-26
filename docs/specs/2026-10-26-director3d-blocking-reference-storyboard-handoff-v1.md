# 3D 导演台占位与深度到分镜交接规范 V1

## 目标

将 3D 导演台自然语言生成的导演参考，转换为可审核、可版本化、可传递到分镜的结构化参考。参考产物包括结构化深度、多人占位参考图、运镜参考视频和动作参考视频。规范覆盖多人占位、前中后景、世界深度、屏幕关系、镜头、可见性和参考媒体用途；不把自然语言提案直接写入分镜，也不把任何参考产物当成最终角色图或最终生成视频。

## 证据与边界

**代码事实：** 当前导演台设计提案支持稳定实体 ID、米制位置、朝向、成对排布、盒体道具和静态摄影机；浏览器占位图可以导出，导演台也已有本地时间轴、动作和视频参考相关工作区；当前浏览器草稿与剧集分镜仍是独立状态，尚未形成统一的四类参考媒体交接合同。

**直接含义：** 3D 导演台可以作为多人空间、摄影机和动作预演的参考来源，但每类参考必须标明用途，并通过显式采纳和 snapshot 才能成为分镜输入。

**未证明：** 生成模型一定遵守占位图、深度或编号关系。结构化交接只证明输入意图和来源，最终图像/视频仍需逐帧审核。

## Owner 边界

| 字段 | 唯一 owner | 3D 导演台 | 分镜 | 模型适配器 |
|---|---|---|---|---|
| 角色身份、外观、身高 | 角色资产 | 只读引用 | 只读引用 | 编译引用 |
| 场景固定几何 | 场景资产 | 只读引用或临时代理 | 只读引用 | 编译引用 |
| 多人位置、深度、朝向 | 导演台占位设计 | 生成和编辑 | 读取快照 | 编译为参考 |
| 占位参考图 | 导演台参考媒体 | 生成和导出 | 选择用途并锁定 | 作为图像参考 |
| 深度参考 | 导演台空间/深度设计 | 生成结构化深度或深度媒体 | 选择用途并锁定 | 仅在模型契约支持时发送 |
| 首帧构图和静态镜头 | 分镜首帧/摄影字段 | 提供候选 | 采纳和覆盖 | 编译 |
| 运镜参考视频 | 导演台摄影预演 | 生成和导出 | 选择用途并锁定 | 仅作为运镜参考 |
| 动作参考视频 | 分镜动效/动作预演 | 提供占位动作预演 | 选择用途并锁定 | 仅作为动作节奏参考 |
| 人群反应和信息差 | 街道冲突与群像 Skill | 提供空间槽位 | 生成时间行为 | 编译 |

导演台不得修改角色、场景或道具永久资产；分镜不得反向修改导演台占位源。

## 规范对象

### 1. 自然语言导演提案 `director_reference_proposal`

自然语言生成先返回导演参考提案，状态为 `draft`，不可直接进入分镜。提案可以同时规划空间、深度、占位图、运镜视频和动作视频的生成，但每种产物必须单独标记状态和用途。

```json
{
  "schemaVersion": "iframe.director3d.director-reference-proposal.v1",
  "proposalId": "proposal-...",
  "baseRevision": "design-fnv1a32:1234abcd",
  "status": "draft",
  "coordinateSystem": {
    "up": "+Z",
    "forward": "+Y",
    "screenRightAtAzimuth0": "+X",
    "units": "meters"
  },
  "sceneRef": {"sceneId": "scene-grain-shop", "revision": "scene-rev-3"},
  "cameraRef": {"cameraId": "camera-main", "revision": "camera-rev-2"},
  "slots": [],
  "visibilityRelations": [],
  "referencePlan": {
    "depth": {"requested": true, "status": "planned"},
    "blockingImage": {"requested": true, "status": "planned"},
    "cameraMotionVideo": {"requested": true, "status": "planned"},
    "actionMotionVideo": {"requested": true, "status": "planned"}
  },
  "assumptions": [],
  "uncertainties": []
}
```

### 2. 占位槽 `blocking_slot`

每个可识别人物、固定群演、匿名群体或关键道具占一个槽位。编号是当前参考图中的空间锚点，不是新的角色身份。

```json
{
  "slotId": "slot-03",
  "label": "3号中景路人",
  "entityRef": {"kind": "fixed_extra", "id": "extra-town-02", "revision": "extra-rev-1"},
  "role": "midground_bystander",
  "positionM": [1.8, 4.2, 0],
  "yawDeg": 180,
  "depthLayer": "mid",
  "screenRegion": "right_mid",
  "poseState": "standing",
  "gazeTarget": "active_zone",
  "visibility": "partial",
  "factionId": "townspeople",
  "props": [],
  "source": "authored"
}
```

允许的 `depthLayer`：`foreground | mid | background`。

允许的 `entityRef.kind`：`lead | supporting | fixed_extra | crowd_template | prop | scene_proxy`。

`crowd_template` 可以表达一组匿名人群，但不能伪装成稳定面孔；`scene_proxy` 只用于空间代理，不得进入角色引用。

### 3. 可见关系 `visibility_relation`

用于表达阁楼能看见粮铺、人物被柜台遮挡、远景人物未获得冲突信息等关系。

```json
{
  "from": "camera-main",
  "to": "slot-01",
  "relation": "visible",
  "occluders": ["prop-counter"],
  "readability": "clear",
  "source": "authored"
}
```

关系类型：

- `visible`
- `partially_visible`
- `occluded`
- `outside_frame`
- `unaware_of_event`

`unaware_of_event` 是叙事信息状态，不等于物理不可见；需要与 `visibility` 分开记录。

### 4. 参考媒体计划与用途

四类参考必须分开记录，不允许用一个 `referenceMedia` 字段混合：

```json
{
  "referencePlan": {
    "depth": {
      "kind": "structured_depth",
      "purpose": "world_depth_and_occlusion",
      "status": "generated",
      "structuredData": {"coordinateSystem": "z_up_meters", "depthRangeM": [0, 12]},
      "mediaId": "depth-media-..."
    },
    "blockingImage": {
      "kind": "blocking_reference_image",
      "purpose": "numbered_multi_subject_layout",
      "status": "generated",
      "mediaId": "blocking-media-..."
    },
    "cameraMotionVideo": {
      "kind": "camera_motion_reference_video",
      "purpose": "camera_path_and_timing",
      "status": "generated",
      "mediaId": "camera-video-..."
    },
    "actionMotionVideo": {
      "kind": "action_reference_video",
      "purpose": "body_motion_and_action_rhythm",
      "status": "generated",
      "mediaId": "action-video-..."
    }
  }
}
```

字段用途边界：

- `depth`：表达世界坐标、层次、遮挡和空间距离；不等于最终视频模型已消费的深度控制输入。
- `blockingImage`：表达编号、站位、前中后景、朝向和构图；不赋予角色新身份。
- `cameraMotionVideo`：只转移摄影机轨迹、景别变化和运镜节奏；不转移人物身份、动作或场景内容。
- `actionMotionVideo`：只转移动作路径、身体节奏和受力参考；不转移参考视频中的角色外观、场景或故事事件。

如果某个模型不支持对应媒体类型，适配器必须标记 `unsupported` 或 `not_submitted`，不能把它伪装成已生效的控制输入。

### 5. 交接快照 `blocking_reference_snapshot`

用户确认后，将提案冻结为不可变快照：

```json
{
  "schemaVersion": "iframe.director3d.director-reference-snapshot.v1",
  "snapshotId": "blocking-snapshot-...",
  "sourceProposalId": "proposal-...",
  "sourceRevision": "design-fnv1a32:1234abcd",
  "sceneRevision": "scene-rev-3",
  "cameraRevision": "camera-rev-2",
  "capturedAt": "2026-10-26T15:00:00Z",
  "slots": [],
  "visibilityRelations": [],
  "referencePlan": {},
  "sourceMediaHashes": {}
}
```

删除角色、群演、场景或 Variant 后，已锁定分镜仍读取快照；未锁定分镜显示缺失引用，不自动换成当前版本。

## 分镜接收结构

分镜只接收 `director_reference_snapshot`，不接收自然语言提案。建议挂载在 `StoryboardConsistencyManifest`：

```json
{
  "director3dBlocking": {
    "snapshotId": "blocking-snapshot-...",
    "sourceRevision": "design-fnv1a32:1234abcd",
    "cameraId": "camera-main",
    "actionAxis": {"from": "苏砚", "to": "江灼", "axisDeg": 90},
    "slots": [
      {
        "slotId": "slot-suyan",
        "entityId": "character-suyan",
        "depthLayer": "foreground",
        "screenRegion": "left_foreground",
        "positionM": [-1.2, 2.0, 0],
        "yawDeg": 90,
        "visibility": "clear"
      }
    ],
    "visibilityRelations": [],
    "referenceMediaIds": ["blocking-media-..."],
    "depthReferenceMediaIds": ["depth-media-..."],
    "cameraMotionReferenceMediaIds": ["camera-video-..."],
    "actionReferenceMediaIds": ["action-video-..."]
  }
}
```

分镜可以在当前镜头增加临时覆盖，例如“中景路人低头绕行”，但不得改写快照中的永久身份、场景几何或基础站位。覆盖必须带 `shotId` 和来源。

## 与街道冲突 Skill 的交接

3D 导演台提供空间事实和参考预演：

- 谁在近景、中景、远景；
- 谁位于冲突区域；
- 谁能看见粮铺；
- 谁被柜台、屋檐或人群遮挡；
- 相机在哪一侧；
- 角色和群体的初始位置。
- 可选的结构化深度和深度参考媒体；
- 可选的占位参考图；
- 可选的运镜参考视频；
- 可选的动作参考视频。

街道冲突 Skill 提供时间行为：

- 哪些中景路人看见并理解冲突；
- 谁先停步、谁后退、谁低头绕行；
- 远景人物为何继续通行；
- 反应如何沿可见区域传播。

因此，`depthLayer` 不等于行为反应，`visibility` 不等于 `awareness`，二者不能合并成一个自然语言字段。

## 采纳与校验

采纳前必须检查：

1. 所有 `entityRef` 能解析到有效的角色、群演、道具或场景版本；
2. 坐标系和单位明确；
3. `slotId` 唯一，实体重复引用有明确理由；
4. 深度层与相机关系不矛盾；
5. 近中远景槽位数量和可见性符合当前镜头；
6. 场景固定几何没有被临时人物动作污染；
7. 用户确认后才生成 snapshot；
8. 分镜提交时重新检查 snapshot 是否仍可解析。

## 成功标准

- 自然语言生成可返回结构化多人占位提案；
- 用户可以在 3D 导演台中审核并修改位置、朝向、深度和摄影机；
- 分镜能引用不可变占位快照；
- 粮铺、阁楼、苏砚/江灼和卖艺少女案例可以复用同一交接格式；
- 角色、场景、道具或群演 Variant 删除时不会静默替换；
- 分镜生成能区分空间快照、摄影机参考、动作参考和群像时间行为；
- 实际图像/视频结果仍作为独立验证，不把结构化输入当作生成质量证明。

## 本阶段不做

- 不把 3D 白模直接当成最终角色图；
- 不声称深度图已被视频模型消费；
- 不自动把每个匿名群演升级为角色资产；
- 不让自然语言生成直接覆盖已锁定分镜；
- 不在本规范中定义具体武打招式或 H3 专用提示词。

## 影响路径

- `src/apps/director_design.py`
- `frontend/src/components/director3d/design/`
- `frontend/src/components/director3d/reference/`
- `src/apps/comic_gen/models.py`
- `src/apps/comic_gen/pipeline.py`
- `tests/test_director_design.py`
- `tests/test_director_shooting_plan.py`

本 spec 先定义交接合同；实现应拆为提案 schema、导演台 snapshot、分镜读取和提交校验四个独立切片。
