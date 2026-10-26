# 3D 导演台占位与深度到分镜交接规范 V1

## 目标

将 3D 导演台自然语言生成的空间设计，转换为可审核、可版本化、可传递到分镜的结构化参考。规范覆盖多人占位、前中后景、世界深度、屏幕关系、镜头和可见性；不把自然语言提案直接写入分镜，也不把占位结果当成角色身份或视频动作。

## 证据与边界

**代码事实：** 当前导演台设计提案支持稳定实体 ID、米制位置、朝向、成对排布、盒体道具和静态摄影机；浏览器占位图可以导出，但当前浏览器草稿与剧集分镜仍是独立状态。

**直接含义：** 3D 导演台可以作为多人空间设计来源，但必须通过显式采纳和 snapshot 才能成为分镜输入。

**未证明：** 生成模型一定遵守占位图、深度或编号关系。结构化交接只证明输入意图和来源，最终图像/视频仍需逐帧审核。

## Owner 边界

| 字段 | 唯一 owner | 3D 导演台 | 分镜 | 模型适配器 |
|---|---|---|---|---|
| 角色身份、外观、身高 | 角色资产 | 只读引用 | 只读引用 | 编译引用 |
| 场景固定几何 | 场景资产 | 只读引用或临时代理 | 只读引用 | 编译引用 |
| 多人位置、深度、朝向 | 导演台占位设计 | 生成和编辑 | 读取快照 | 编译为参考 |
| 首帧构图和镜头 | 分镜首帧/摄影字段 | 提供候选 | 采纳和覆盖 | 编译 |
| 动作时间轴和受力 | 分镜动效 Skill | 可提供预演参考 | 唯一 owner | 编译 |
| 人群反应和信息差 | 街道冲突与群像 Skill | 提供空间槽位 | 生成时间行为 | 编译 |

导演台不得修改角色、场景或道具永久资产；分镜不得反向修改导演台占位源。

## 规范对象

### 1. 草稿提案 `blocking_reference_proposal`

自然语言生成只能返回提案，状态为 `draft`，不可直接进入分镜。

```json
{
  "schemaVersion": "iframe.director3d.blocking-reference-proposal.v1",
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

### 4. 交接快照 `blocking_reference_snapshot`

用户确认后，将提案冻结为不可变快照：

```json
{
  "schemaVersion": "iframe.director3d.blocking-reference-snapshot.v1",
  "snapshotId": "blocking-snapshot-...",
  "sourceProposalId": "proposal-...",
  "sourceRevision": "design-fnv1a32:1234abcd",
  "sceneRevision": "scene-rev-3",
  "cameraRevision": "camera-rev-2",
  "capturedAt": "2026-10-26T15:00:00Z",
  "slots": [],
  "visibilityRelations": [],
  "referenceMedia": {
    "blockingPngMediaId": "media-...",
    "depthMediaId": null,
    "sourceSha256": "..."
  }
}
```

删除角色、群演、场景或 Variant 后，已锁定分镜仍读取快照；未锁定分镜显示缺失引用，不自动换成当前版本。

## 分镜接收结构

分镜只接收 `blocking_reference_snapshot`，不接收自然语言提案。建议挂载在 `StoryboardConsistencyManifest`：

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
    "referenceMediaIds": ["media-..."]
  }
}
```

分镜可以在当前镜头增加临时覆盖，例如“中景路人低头绕行”，但不得改写快照中的永久身份、场景几何或基础站位。覆盖必须带 `shotId` 和来源。

## 与街道冲突 Skill 的交接

3D 导演台提供空间事实：

- 谁在近景、中景、远景；
- 谁位于冲突区域；
- 谁能看见粮铺；
- 谁被柜台、屋檐或人群遮挡；
- 相机在哪一侧；
- 角色和群体的初始位置。

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
- 分镜生成能区分空间快照和群像时间行为；
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
