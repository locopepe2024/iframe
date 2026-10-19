# Director 3D StoryAI reference migration v1

## Goal

把 `storyai-3d-director-desk` 可验证的交互模式移植到 iframe 导演台，
重点提升第 3 项“占位、深度、场景参考图”和第 5 项“运镜视频参考”的易用性。

移植对象是浏览器端的摆位和机位设计体验。iframe 现有的 Blender 米制深度、
远端失败语义、白模录制快照和资产 revision 边界保持不变。

## Evidence boundary

### Observed: storyai-3d-director-desk

- 使用 React、Three.js、React Three Fiber 和 Zustand。
- 通过对象树、右侧属性面板和导演视角 / 机位视角切换完成快速摆位。
- 场景对象包含位置、旋转、缩放、可见性、锁定和稳定 ID。
- 相机包含位置、FOV、目标点和目标对象绑定。
- 支持角色姿势预设、群众阵列、全景背景、画幅框、九宫格和截图记录。
- 全景导入有比例、接缝和极点处理。

### Observed: storyai-3d-director-desk 未实现

- 未发现时间线、关键帧、相机路径、角色运动轨迹或 MediaRecorder 视频导出。
- 未发现 Blender、远程渲染、米制深度 PNG/EXR 或视频媒体服务。
- 截图结果是 PNG data URL，不是带 shot/package provenance 的参考资产。

### Direct implication

可移植价值集中在低学习成本的对象树、属性编辑、模板入口、相机目标和画幅辅助。
不能把它的静态机位或截图能力当作 iframe 的运镜视频、米制深度或场景资产一致性实现。

### Not yet proven

这些交互是否提升下游生成的一致性，仍需以同一 `DirectorShotPackage` 的对比生成测试验证。

## Product boundaries

### iframe remains authoritative for

- 已确认角色、场景、道具资产及其 revision。
- 场景坐标、深度层级、相机轴线和物理相机字段。
- Blender 生成的米制深度 PNG / EXR 和相机记录。
- 浏览器白模、Clay、Pose 参考视频的录制快照。
- 远端 media 失败直接失败，不回退本机。

### StoryAI reference may provide

- 空场景、单人、双人对话、多人物 blocking、道具镜头模板入口。
- 对象树分组、搜索、可见性、锁定和快速选择。
- 导演视角 / 机位视角切换。
- 当前视角创建机位、目标对象绑定、画幅框和九宫格。
- 群众阵列和姿势预设的快速入口。
- 全景图导入后的方向调整和场景背景预览。

## Unified shot package

所有可导出的占位图、深度、场景参考图、白模视频和后续提示词，都必须从同一个
版本化 `DirectorShotPackage` 投影生成。

Required provenance:

```text
schemaVersion
shotId / packageRevision / packageChecksum
sceneId / sceneRevision
characters: assetId, identityRevision, lookRevision, pose, transform, facing, visibility
props: assetId, variantId, transform, dimensions, facing, visibility
camera: id, transform, target, focalLengthMm, fovDeg, fStop,
        focusDistanceM, clipStartM, clipEndM, aspectRatio
timeline: duration, fps, activeCameraTrack, actorTracks, cameraKeyframes
environment: mode, panoramaAssetId, rotation, exposure
lights: id, type, transform, color, intensity, enabled
units / coordinateSystem
```

`DirectorShotPackage` 是只读投影；现有导演台状态仍是编辑真源。资产管理完成后，
导演台只读取已确认的 `character_id`、`identity_revision`、`look_revision`、
`scene_variant_id` 和道具 `asset_id + variant_id`，不回写资产身份或造型。

## Capability slices

### Slice A: reference interaction migration

移植对象树、模板入口、相机目标和画幅辅助的交互模式。

Acceptance:

- 新建空场景、单人、双人对话和多人 blocking 时，角色位置、朝向和深度顺序确定且可撤销。
- 选择对象后，视口直接操作和数值面板修改使用同一个 transform 状态。
- 相机可从当前视角创建，并可绑定到角色或道具目标。
- 画幅框与截图、占位图和录制使用同一 aspect ratio。
- 模板创建的对象带稳定 ID，不产生隐式重复资产。

### Slice B: depth-aware blocking and scene references

把“站位图”明确为三维空间关系，而不是二维草图。

Required behavior:

- 显示左右、前后、深度层级、朝向和遮挡关系。
- 对象和相机使用米制坐标；浏览器预览深度明确标为预览值。
- 场景参考图、全景背景、灰色预览背景和深度图在 UI 和导出中分开命名。
- 场景、角色、道具或相机 revision 变化后，旧深度和旧参考图显示 stale。
- 占位图、Blender 深度 PNG/EXR、相机记录和场景参考图携带同一 package checksum。

### Slice C: camera movement authoring

把参考项目的“当前视角创建机位”扩展为可编辑运镜段。

Required presets:

- 固定机位
- 推进 / 拉远
- 横移
- 摇镜
- 跟拍
- 环绕
- 升降
- 手持抖动

Preset output must be ordinary editable camera keyframes and path points. Presets
must not create an opaque animation blob.

### Slice D: white-model motion reference video

白模视频用于快速查看角色运动和运镜，不是视频转白模。

Required behavior:

- 同一时间线评估角色运动和相机运动。
- 支持白模、Clay、Pose 三种参考模式；模式名称必须明确。
- 录制绑定 `shotId`、package revision/checksum、active camera、aspect ratio、duration 和 FPS。
- 录制前隐藏辅助线、选择框、机位线框和编辑手柄；结束、取消、失败都恢复编辑状态。
- 多机位同画幅可连续录制；不同画幅必须统一画幅或按镜头段分别导出。
- 设置变化后保留最后有效结果，并显示旧结果的失效原因。

## Interaction rules carried over

1. **一个活动镜头上下文**：视口、属性面板、时间线和导出结果都指向同一 shot 和 camera。
2. **渐进式展开**：先提供添加角色、添加道具、添加机位、模板、画幅和录制；选中对象后再展示骨骼、镜头物理参数和关键帧。
3. **快速可逆循环**：模板 → 摆位 → 姿势 → 对机 → 运镜预设 → 预览 → 录制 → 复核。
4. **空间真值在视口**：地面路径、相机视锥、目标点和遮挡在同一坐标系显示。
5. **输出模式显式命名**：构图预览、占位图、白模视频、Pose、深度预览、米制深度导出分别呈现。
6. **无静默状态变化**：模板、运镜预设和渲染覆盖都可撤销并显示变更范围。
7. **真实边界可见**：浏览器参考、Blender 米制媒体和提示词元数据不能混称为同一种输出。

## Delivery order

1. 先完成 Slice A 的模板、对象树和相机目标交互移植。
2. 接入统一 `DirectorShotPackage`，再完成 Slice B 的深度和 stale 绑定。
3. 在 package parity 测试通过后完成 Slice C 的运镜预设。
4. 最后扩展 Slice D 的白模 / Clay / Pose 录制和结果回写分镜。

不在本迁移中引入 Blender 替代方案、视频转白模、自由提示词改写坐标或本机 fallback。

## Verification

- TypeScript 类型检查和导演台 focused tests 通过。
- 两人对话 fixture 验证左右关系、前后深度、朝向、遮挡顺序和相机目标。
- 35mm / f2.8 / 5m 相机在浏览器 package、Blender manifest 和 camera record 中保持可区分。
- 角色路径和相机路径在同一帧评估器中得到一致状态。
- 修改资产或镜头设置后，旧占位图、深度和视频显示 stale，最后有效结果仍可查看。
- 取消、失败和关闭期间不丢失编辑状态，也不把浏览器预览伪装为米制媒体结果。

## Affected paths

- `frontend/src/components/director3d/`
- `frontend/src/components/director3d/reference/`
- `frontend/src/components/director3d/timeline/`
- `frontend/src/components/director3d/state/`
- `frontend/src/components/director3d/scene/`
- `frontend/src/components/director3d/reference/director-shot-package.ts`

