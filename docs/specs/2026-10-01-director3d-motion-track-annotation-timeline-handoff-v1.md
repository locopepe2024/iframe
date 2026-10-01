# Director 3D motion-track annotation timeline handoff v1

## 目标

将复刻侧生成的 `motion-track-annotation-review.v1` 接入 3D 导演台时间轴，
让导演可以只处理自动采集失败或身份不确定的帧，再重新编译 canonical
`motion-track.v1` 和 `director-full-motion-bundle.v1`。

本交接只处理目标人物身份、关键点修正和审核状态。它不实现 Blender
重定向、IK 或媒体渲染 worker。

## 当前样本

当前 `recreation2-final120.json` 样本包含 120 个源帧，其中 79 帧有目标
关键点，41 帧需要人工审核。原始数据把部分目标匹配失败标记为
`occluded`，这不能直接当作真实遮挡。导演台必须允许人工改成身份恢复、
检测器漏检、真实遮挡或出画。

## 目录和责任边界

### 只读输入

`motionTrackImport.manifest` 是复刻侧导入的原始 `motion-track.v1`，在导演台
中保持只读。现有导入逻辑位于：

```text
frontend/src/components/director3d/state/motion-track-import.ts
frontend/src/components/director3d/reference/MotionTrackImporter.tsx
```

### 审核覆盖层

新增状态文件：

```text
frontend/src/components/director3d/state/motion-track-review.ts
```

新增面板：

```text
frontend/src/components/director3d/reference/MotionTrackReviewPanel.tsx
```

审核覆盖层不能直接修改原始导入对象。导出前由纯函数将原始轨迹和覆盖层
合并为新的 `motion-track.v1`。

## 输入契约

导演台接受：

```json
{
  "schema": "motion-track-annotation-review.v1",
  "source_track_revision": "sha256...",
  "target_subject_id": "person-center",
  "total_frames": 120,
  "review_required_frames": 41,
  "frames": [
    {
      "frame": 137,
      "timestamp_seconds": 4.4318,
      "current_status": "occluded",
      "suggested_status": "manual_review_required",
      "target_track_id": "person-center",
      "candidates": [
        {
          "pose_index": 0,
          "bbox": [0.09, 0.30, 0.35, 0.89],
          "center": [0.22, 0.59],
          "distance_to_previous_center": 0.30
        }
      ],
      "joint_overrides": {},
      "reviewer_note": ""
    }
  ]
}
```

`source_track_revision` 必须与当前只读 motion-track 的 `source_revision`
匹配。来源不匹配时拒绝应用，避免把旧审核覆盖到新视频。

## 审核状态

```ts
type MotionTrackReviewStatus =
  | "tracked"
  | "manual_recovered"
  | "detector_missed"
  | "real_occlusion"
  | "out_of_frame"
  | "pending";
```

含义：

- `tracked`：自动目标和关键点可信；
- `manual_recovered`：人工选择了正确候选人物；
- `detector_missed`：画面可见，但检测器漏检或关键点不完整；
- `real_occlusion`：源画面有直接可见的遮挡证据；
- `out_of_frame`：目标人物确实离开画面；
- `pending`：尚未完成审核。

不能把 `pending`、`real_occlusion` 或 `out_of_frame` 静默转换成完整姿态。

## Workbench 状态

在现有 workbench store 增加：

```ts
type MotionTrackReviewState = {
  status: "idle" | "ready" | "reviewing" | "approved";
  manifest: MotionTrackAnnotationReview | null;
  selectedFrame: number | null;
  editedFrames: Record<number, MotionTrackFrameReview>;
  dirty: boolean;
  errors: string[];
};
```

需要的 actions：

```text
loadMotionTrackReviewManifest
selectMotionTrackReviewFrame
setMotionTrackReviewStatus
setMotionTrackReviewCandidate
setMotionTrackJointOverride
setMotionTrackReviewerNote
clearMotionTrackFrameReview
compileReviewedMotionTrack
resetMotionTrackReview
```

所有会改变 `editedFrames` 的操作写入一次 undo command。导入 review manifest
本身不写入姿态时间线。

## 时间轴接入

现有播放头使用 `playheadFrame`。审核面板必须复用该状态，不能创建第二个
独立播放头。

每个问题帧在 timeline 上渲染一个 marker：

| 状态 | 颜色 | 行为 |
| --- | --- | --- |
| `pending` | 黄色 | 点击后打开人工审核面板 |
| `manual_recovered` | 蓝色 | 点击后显示人工选择和备注 |
| `detector_missed` | 橙色 | 点击后要求重新提取或补点 |
| `real_occlusion` | 红色 | 显示遮挡证据，不允许自动补帧 |
| `out_of_frame` | 灰色 | 显示出画状态，不允许自动补帧 |
| `tracked` | 绿色 | 可选显示，不进入待审核计数 |

点击 marker 必须：

1. 设置 `playheadFrame`；
2. 显示对应源视频帧或 evidence frame；
3. 显示候选人物 bbox；
4. 显示当前白模帧；
5. 打开该帧的审核表单。

## 审核表单

最小交互：

```text
候选人物：pose 0 / pose 1 / 无目标
状态：人工恢复 / 检测器漏检 / 真实遮挡 / 出画
关节修正：肩、肘、腕、髋、膝、踝，可选
备注：自由文本
保存本帧
```

关节编辑必须显示坐标系和单位。二维来源需要明确标注为归一化图像坐标，
三维覆盖值必须满足当前 motion-track 坐标系声明。没有直接证据时不自动
生成深度值。

## 编译 reviewed motion-track

纯函数接口：

```ts
compileReviewedMotionTrack(
  source: MotionTrackManifest,
  review: MotionTrackReviewState,
): { manifest: MotionTrackManifest; report: MotionTrackReviewReport }
```

编译规则：

1. 自动通过帧保留原始 semantic joints；
2. `manual_recovered` 使用人工选择的候选姿态；
3. `detector_missed` 只有在人工填写关节或重新提取成功后才能进入输出；
4. `real_occlusion` 和 `out_of_frame` 保留空关节并写入 selection status；
5. 不允许用前后帧插值覆盖未经审核的 `pending`；
6. 输出新的 `source_revision`，记录原始 revision 和 review revision；
7. 报告必须列出仍然缺失的帧和关节。

导出文件建议：

```text
motion-track.raw.json
motion-track-annotation-review.v1.json
motion-track.reviewed.v1.json
motion-track-review-report.json
```

## 导出门槛

允许生成 full motion bundle 的条件：

```text
review.status = approved
pending frame count = 0
source revision matches
所有 manual_recovered 帧有候选或关节覆盖
real_occlusion / out_of_frame 已明确保留
```

导出前显示：

```text
总帧数
自动通过帧数
人工恢复帧数
检测器漏检帧数
真实遮挡帧数
出画帧数
仍待审核帧数
```

## 验收标准

- 导入当前样本后显示 41 个待审核 marker；
- 点击 marker 能与 `playheadFrame` 同步跳转；
- 选择候选人物后状态变为 `manual_recovered`；
- 保存后刷新页面仍能恢复 review overlay；
- 修改 review 不改变只读 motion-track manifest；
- 未完成审核时导出按钮禁用；
- 编译后的轨迹能重新进入现有 motion-track importer；
- 导出报告能说明每个缺失帧的原因；
- 关键帧修正后能重新生成 white model preview；
- 通过一次 undo 可以撤销一帧人工标注。

## 不在本阶段

- 自动判断真实遮挡；
- 自动生成可靠三维深度；
- 浏览器内运行 Blender；
- media worker 队列和生产部署；
- 多角色自动身份重建；
- IK 和脚部接触求解。
