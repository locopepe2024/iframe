# 动作捕捉与标注分析系统 v1

## 目标

建立一条可复用的证据链：从源视频和PTS帧开始，保存多模型姿态、人工区域标注、坐标映射诊断和可重放的动作资产包。系统用于判断源点、模型点和目标rig投影之间的差异，不把模型推断自动升级为真值。

本版本只定义数据边界和最小工作流，不修改现有姿态提取器、builder、rig、相机或H3链路。

## 证据分层

| 层 | 内容 | 是否可作为真值 |
|---|---|---|
| `observed` | 源视频帧、PTS、原图尺寸、人工可见区域、遮挡状态 | 仅人工复核项可作为审查依据 |
| `inferred` | MediaPipe、RTMPose及其他模型输出、置信度、可见性 | 否 |
| `derived` | 坐标缩放、时间映射、投影、误差、相机拟合、rig重定向结果 | 否，必须可重算 |
| `reviewed` | 人工接受、拒绝、不可评、容差带及备注 | 是人工审查记录，不等于3D真值 |
| `asset` | 面向下游的动作包和质量摘要 | 必须携带来源与不确定性 |

## 最小实体

### `SourceClip`

```json
{
  "clip_id": "recreation2-clip-exact10",
  "path": "...",
  "sha256": "...",
  "width": 1394,
  "height": 792,
  "pts_authoritative": true,
  "frame_count": 308,
  "fps_nominal": null
}
```

### `FrameRecord`

```json
{
  "clip_id": "...",
  "source_frame": 17,
  "pts_s": 0.783655,
  "image_sha256": "...",
  "image_size": [1394, 792],
  "sampling_status": "source_pts"
}
```

### `PoseObservation`

```json
{
  "frame_id": "...:17",
  "model": "mediapipe|rtmpose",
  "model_version": "...",
  "coordinate_space": "source_pixels",
  "joints": {
    "left_knee": {"xy": [749.68, 522.91], "score": 0.98, "visibility": 0.97}
  },
  "status": "ok|low_confidence|collapsed|missing"
}
```

### `ReviewAnnotation`

```json
{
  "frame_id": "...:17",
  "annotator": "...",
  "tool": "label-studio",
  "regions": {
    "left_knee_visible": {"type": "ellipse", "xyxy": [..], "status": "visible"},
    "right_knee_visible": {"type": "ellipse", "xyxy": [..], "status": "visible"},
    "support_foot": {"type": "polygon", "points": [[..]], "status": "uncertain"}
  },
  "frame_status": "reviewed|occluded|not_evaluable",
  "notes": "..."
}
```

### `ProjectionDiagnostic`

```json
{
  "frame_id": "...:17",
  "target_camera": {"width": 640, "height": 360, "intrinsics_status": "candidate"},
  "mapping": {"source_to_target": "axis_scale_xy", "scale_xy": [0.4591, 0.4545]},
  "points": {
    "left_knee": {
      "observed": [344.19, 237.69],
      "inferred": [344.19, 237.69],
      "target": [354.41, 264.57],
      "target_to_observed_px": 26.20,
      "review_region_distance_px": null
    }
  },
  "status": "diagnostic_only"
}
```

### `MotionAssetPackage`

目录固定为：

```text
motion-asset-package/
  manifest.json
  source/
    clip.json
    frames.jsonl
    images/
  observations/
    mediapipe.jsonl
    rtmpose.jsonl
  annotations/
    label-studio-export.json
    normalized.jsonl
  diagnostics/
    projections.jsonl
    reports/
  retarget/
    rig-manifest.json
    bundle.json
  quality/
    frame-status.jsonl
    summary.json
```

资产包必须包含输入哈希、模型/rig/脚本版本、坐标系、画幅、PTS映射、人工标注状态和质量限制。任何`derived`文件都应能由manifest中的输入重新生成。

## 最小工作流

1. 固化源视频SHA、PTS和原图尺寸。
2. 以源PTS抽取事件帧，不使用平均FPS替代时间轴。
3. 运行MediaPipe和RTMPose，原始输出分开保存。
4. 导入Label Studio，只标六个事件帧：1、17、23、29、41、55。
5. 首轮只标双膝可见区域、支持脚区域和不可评状态。
6. 将标注导出为规范化JSON，并保留原始Label Studio导出。
7. 计算模型点、目标投影点到人工区域的距离。
8. 生成质量摘要，分别报告`observed`、`inferred`、`derived`和`reviewed`，再决定是否进入rig或IK实验。

## 质量门槛

- 源图SHA与FrameRecord一致。
- PTS严格递增，源帧号不被重新编号覆盖。
- MediaPipe/RTMPose坐标转换必须逐轴缩放，不能直接缩放距离标量。
- 所有误差报告写明画幅和样本范围。
- 不可评帧不能用中位数隐式覆盖。
- 人工区域未标注时，`review_region_distance_px`必须为`null`。
- 资产包不能把`inferred`点标记成`ground_truth`。

## 当前范围与后续边界

当前只建立数据契约和六帧试运行。Label Studio是人工审查入口，不承担相机标定、深度恢复、rig求解或IK。焦距、骨盆、父空间和接触实验继续作为独立诊断任务，通过资产包引用输入和输出。

## 验收标准

- 六帧可以从源PTS重建并复核SHA。
- 两个模型的原始结果可并列查看。
- 膝部和支持脚标注可导出并转换为规范化格式。
- 诊断报告能区分人工区域距离、模型间分歧和目标投影误差。
- 不改动现有主链路即可重复生成资产包。

## 开源组件组合

本系统不寻找一个包办所有能力的仓库，而采用分层组合：

| 层 | 组件 | 边界 |
|---|---|---|
| 标注入口 | Label Studio | 时间段、动作标签、膝/脚区域、遮挡和人工状态 |
| 标注转换 | label-studio-converter | 将导出转换为项目规范格式；不负责PTS语义 |
| 数据集转换 | Datumaro | 数据集导入、导出、格式一致性和统计 |
| 数据浏览 | FiftyOne（可选） | 多模型结果和样本浏览；不作为资产真值层 |
| 文件版本 | DVC（首选）或lakeFS | 大文件和数据集版本、内容哈希 |
| 语义资产包 | iFrame manifest/JSON | PTS、坐标系、相机、rig、模型、诊断关系和质量状态 |

DVC/lakeFS记录文件版本，不记录动作语义关系。因此下列关系必须由项目manifest维护：

```text
source_frame 17
  -> pts 0.783655s
  -> MediaPipe observation
  -> RTMPose observation
  -> Label Studio review region
  -> target rig projection
  -> diagnostic error
```

## 版本边界

- **文件版本**：视频、帧图、模型输出、标注导出和动作包由DVC或lakeFS跟踪。
- **语义版本**：manifest中的schema版本、坐标系、PTS映射、rig哈希、模型版本和脚本哈希由iFrame维护。
- **重算关系**：manifest必须能指向产生每个`derived`文件的输入和工具版本。
- **不可变发布**：发布动作包时冻结manifest和所有输入哈希；后续修订生成新package_id，不覆盖旧包。

## 最小发布清单

```text
package_id
manifest_schema
source_clip_sha256
frames_sha256
annotation_export_sha256
normalized_annotation_sha256
model_observation_sha256
rig_sha256
camera_spec_sha256
retarget_bundle_sha256
producer_git_commit
producer_script_sha256
quality_status
limitations[]
```

## 组件选择原则

第一阶段优先使用Label Studio + 自有manifest + DVC，不同时引入CVAT、FiftyOne和lakeFS。Datumaro只在出现多格式交换需求时加入。这样可以减少重复的任务、数据集和版本语义，保持当前六帧诊断链路可复核。
