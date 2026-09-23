# 3D 导演台本地白模动画导入 V1

## 状态

- 状态：V1 已实现，待浏览器现场验收
- 日期：2026-09-23
- 范围：iframe Director 3D 导演台浏览器端

## 目标

支持用户把本地生成或整理好的白模动画关键帧 manifest 导入当前导演台，先预览，再确认写入时间线。导入结果必须能继续使用现有播放头、关键帧编辑、撤销/重做和本地草稿保存。

## 证据与边界

### 已观察

- `DialogueTimelineState` 已有 FPS、时长和通用关键帧轨道。
- `TimelineTrackState` 已支持 `character_pose` 与 `character_transform` 两类人物轨道。
- 导演台已有本地草稿和 authoring undo/redo。
- 当前浏览器导演台不负责上传、模型调用或 MP4 导出。

### 直接含义

- V1 只需把本地文件映射为现有人物姿态/变换轨道。
- 播放时已有人物/机位路径先作为空间运动基线，显式的变换关键帧随后覆盖同一属性，避免导入轨道被默认路径静默覆盖。
- 文件需要在状态变更前完成 schema、时长、FPS、角色目标和关键帧校验。
- “应用导入”是一次可撤销命令；预览或校验失败不能改变当前时间线。

### 尚未证明

- 任意 GLB、FBX、BVH 或视频文件能在浏览器中可靠解析为当前 rig 的关节语义。
- 仅凭姿态关键帧即可生成真实动画视频。
- 外部工具导出的坐标系、骨骼命名和当前 humanoid rig 一致。

这些能力留给后续真实动画/视频生成验证，不在本 V1 承诺。

## V1 输入契约

文件类型：`.json`，UTF-8，大小不超过 2 MiB。

```json
{
  "schemaVersion": "iframe.director3d.local-animation.v1",
  "manifestId": "fight-take-01",
  "title": "15 秒白模武打",
  "durationSeconds": 15,
  "fps": 24,
  "source": { "kind": "local", "label": "fight-take-01.json" },
  "tracks": [
    {
      "trackId": "track-a-pose",
      "trackKind": "character_pose",
      "target": { "characterId": "character-female-c001" },
      "propertyKey": "pose.normalized_values",
      "keyframes": [
        { "timeSeconds": 0, "value": { "root": [0, 0, 0] }, "interpolation": "step" }
      ]
    },
    {
      "trackId": "track-a-transform",
      "trackKind": "character_transform",
      "target": { "characterId": "character-female-c001" },
      "propertyKey": "transform.position_m",
      "keyframes": [
        { "timeSeconds": 0, "value": [-1, 0, 0], "interpolation": "bezier" }
      ]
    }
  ],
  "limitations": ["本地白模预览；不生成 MP4"]
}
```

允许的轨道只有 `character_pose` 和 `character_transform`。目标角色可以使用当前导演台已存在的 `characterId`，也可以使用 `A`、`B`、`C` 槽位别名，由导入层映射到当前角色。

姿态值为 `{ [jointId]: [x, y, z] }`，角度单位为度；变换值为 `[x, y, z]` 米。关键帧时间必须在 `[0, durationSeconds]` 内且有限；同一轨道时间重复时保留文件中最后一帧。插值只接受 `step`、`linear`、`bezier`。

## 交互流程

1. 时间线标题栏提供“导入白模动画”按钮，打开本地 JSON 选择器。
2. 选择后立即在内存中解析和校验，展示文件名、时长、FPS、轨道数、关键帧数、角色映射和限制说明。
3. 校验失败只展示错误与修复提示，不写入状态。
4. 用户点击“应用到时间线”后：
   - 将导入轨道追加到当前时间线；
   - 导入时长大于当前时长时扩展时间线；
   - 时间线 FPS 切换为 manifest FPS，保证关键帧按来源帧率播放；
   - 应用后播放头停在第 1 帧；
   - 写入一条 `timeline.local_animation_import` 命令；
   - 整次应用进入一次 undo 栈。
5. 用户点击“取消”或关闭预览时，当前时间线不变。

## 安全与限制

- 仅读取用户明确选择的本地 `.json` 文件，不上传、不发起网络请求。
- 限制文件大小、轨道数量、关键帧数量、轨道 ID 和文本长度，避免异常 manifest 阻塞 UI。
- 应用时只允许人物姿态/变换轨道；不覆盖对白、镜头、环境或路径事件。
- 当前角色锁定时拒绝对应轨道；已有同一 `trackId` 时以新导入轨道替换，避免重复轨道。
- 本地草稿序列化保留已应用轨道；不持久化待确认的文件对象或预览状态。
- V1 不实现 GLB/FBX/BVH/视频解码、骨骼自动重定向、动作意图生成或真实动画视频生成。

## 与动作结构数据库的边界

后续可以把“历史视频 → 抽帧时间线 → 姿态映射”或 Agent 的“鹤形拳”等动作意图输出为本 manifest，再由本地导入入口验证白模时间线。该转换器、动作意图生成和真实动画/视频生成仍分别验收，不在本 V1 内隐式调用。

## 成功标准

- 合法 JSON 可预览并在确认后出现人物姿态/变换轨道。
- 非法 schema、FPS、时长、目标角色、轨道类型或关键帧会被拒绝，并给出可理解的错误。
- 预览阶段不改变时间线；取消不产生 undo 记录。
- 应用后可撤销并恢复导入前轨道，重做可再次应用。
- 保存并恢复本地草稿后，已导入轨道仍在。
- 单元/组件测试证明导入过程不调用网络。

## 受影响路径与验证

- `frontend/src/components/director3d/types.ts`
- `frontend/src/components/director3d/state/local-animation-import.ts`
- `frontend/src/components/director3d/state/workbench-store.ts`
- `frontend/src/components/director3d/timeline/TimelinePanel.tsx`
- `frontend/src/components/director3d/styles.css`
- `frontend/src/components/director3d/DirectorWorkbench.test.tsx`
- `frontend/src/components/director3d/state/local-draft.ts`

验证命令：

```bash
cd frontend
npm run typecheck
npm run test -- --run src/components/director3d/DirectorWorkbench.test.tsx
npm run build
```
