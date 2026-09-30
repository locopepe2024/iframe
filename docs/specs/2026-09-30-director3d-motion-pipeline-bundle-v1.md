# Director 3D 动作编排与 full_motion.bundle v1

## 目标

把已导入的 `motion-track.v1` 编排为一个可审阅、可复现的本地动作结果：

```text
motion-track.v1
  → local quaternion retarget
  → cleanup processors
  → foot contact evaluation
  → accepted contact 的逐帧 leg IK
  → full_motion.bundle.v1
```

这是浏览器内的确定性编排，不调用模型、不上传素材、不写入姿态时间线。

## 顺序与回退

1. retarget 只使用 `tracked` / `interpolated` 帧；其他状态保留 root 和 warning，不伪造姿态。
2. cleanup 只处理已有 quaternion，并记录处理器及参数。
3. foot contact 使用源轨迹的脚部目标、置信度、连续帧、速度和地面标定结果。
4. 只有 `accepted` 的脚部接触才进入 IK。
5. IK 需要完整髋、膝、踝、目标点和 pole target。缺失、不可达、退化或残差超限时，输出拒绝原因，并完整保留该侧进入 IK 前的 quaternion。
6. 左右脚独立处理；一侧失败不影响另一侧。

## bundle 边界

`full_motion.bundle.v1` 是导演审阅和后续 Blender 编译的候选数据，不代表真实骨骼校准、物理接触或最终动画。bundle 必须包含：

- source track revision、mapping revision、rig profile
- cleanup processor 快照
- 每帧 root、pelvis、local quaternion
- 每帧左右脚接触评估和 IK 结果
- warnings 和 preview 状态

导出入口产生两个 JSON 文档：

- `full_motion.bundle.json`：完整逐帧结果。现有稳定导出契约的 schema 是 `director-full-motion-bundle.v1`；编排器内部的逐帧审阅结果使用 `full_motion.bundle.v1`，两者都不代表已完成 Blender 渲染。
- `retarget_manifest.json`：轻量核对清单，只包含来源、映射、坐标系、帧数、每帧关节 ID 和 warning，不包含完整 local quaternion 数值。

两份文档都带有版本化 `schema`，可独立解析。浏览器导出前不写入服务器；后续上传或 Blender 编译必须由用户明确触发。

预览状态只描述是否具备白模编译输入，不伪造 MP4、GLB 或渲染 URL。

## 验收

- retarget、cleanup、contact、IK 在同一调用中按上述顺序执行。
- 未接受的接触不会调用 IK。
- IK 失败保留原 quaternion 并暴露稳定 reason。
- bundle 可 JSON 序列化，包含 revision 和完整逐帧证据。
- 输入结果不被原地修改。

## 不在本阶段

- 从 GLB/Blender 自动校准 rest quaternion
- spine 分摊、全身 IK、地面求交和动作质量评分
- Blender 实际导出、视频渲染、provider 提交
- 将 bundle 自动应用到现有姿态时间线

## Legacy media track normalization

The 2026-09-30 media fixture at `/home/ubuntu/motion-track/output/recreation2-final120.json` is labeled `motion-track.v1` but still uses the legacy `target_landmarks` frame shape. It lacks the canonical root `coordinate_system`, `semantic_joints`, `joint_confidence`, `foot_targets`, and `foot_contact_candidates` fields required by the Director 3D importer.

Use `scripts/director3d/normalize_motion_track.py` as an explicit one-way adapter. It preserves the raw source SHA-256 as `source_revision`, maps MediaPipe joints by index, leaves occluded frames without semantic joints, and initializes contact candidates to false. It does not infer root motion, ground contact, or 3D depth. The importer remains strict.

The media fixture conversion produced 120 frames, 79 tracked frames with semantic joints, and 79 frames with left ankle data. This verifies structural conversion, not retarget quality.

## Blender bundle compile verification

`scripts/director3d/render_full_motion_bundle.py` now compiles a `director-full-motion-bundle.v1` into the existing media rig without re-running retargeting. A 24-frame fixture was executed on media with Blender 4.5.9 and produced:

- `white_model_video.mp4`: 640×360, 24 fps, 1.0 s;
- `white_model_preview.png`: 640×360 PNG;
- `full_motion.bundle.json`;
- `retarget_manifest.json` with `director-media-render-result.v1` status `completed`.

This verifies the Blender artifact path and codec settings. It does not yet verify calibrated dance motion because the fixture used identity pose quaternions.
