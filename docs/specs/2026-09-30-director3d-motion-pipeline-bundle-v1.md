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
## 2026-10-01 direction validation evidence

The diagnostic `scripts/director3d/validate_bundle_directions.py` was run on
the media rig at frames 1 and 95. The current `restQuaternion * delta` bundle
had errors of 52–167 degrees on the measured limb channels. This proves the
rendered pose is not a faithful direction retarget.

Candidate comparison on the same rig and source frames:

- `restQuaternion * delta`: pelvis 166.7°, upper leg 51.8°, lower leg 103.7° at frame 1.
- `delta` alone: lower legs improved to 28.8°/31.4° at frame 95, but frame 1 remained above 90° on most channels.
- `delta * restQuaternion`: pelvis improved to 15.0° at frame 95, while lower leg and foot errors remained above 57°.

These results are diagnostic evidence only. They do not establish a final
rotation composition because the comparison still lacks parent-space rest
rotation compensation and a reliable 3D source depth. The next implementation
slice must evaluate rotations in each bone's parent rest space before adding IK.

A first parent-space prototype was evaluated on frames 1 and 95. It reduced
some lower-leg errors to 24–49 degrees, but increased upper-leg and foot
errors to 99–142 degrees on other channels. This rejects the prototype as a
production solver. The remaining issue is likely the distinction between
Blender edit-bone rest matrices and pose-bone local rotation basis; the
prototype must not be promoted without a rest-pose unit test that applies a
known rotation and recovers the expected world direction.

The Blender rest-pose probe confirms that pose quaternion semantics are
hierarchy-dependent. Applying a known 15-degree local rotation to
`upper_leg_l` matched the evaluated world direction when the armature-space
rest matrix and local quaternion were composed in the evaluated order (0°
probe error). The same shortcut failed for `lower_leg_l` because its parent
chain contributes an additional evaluated transform. Therefore the solver
must use evaluated parent pose matrices per bone; multiplying a static rest
quaternion by a source delta is not equivalent.

An updated prototype resets each frame, orients the pelvis parent from the
source hip-center to shoulder-center vector, and solves child channels using
the evaluated parent pose matrix. On frames 1 and 95 this reduced upper-leg
errors to 13–30 degrees, lower-leg errors to below 4 degrees, and foot errors
to 0 degrees. This is an algorithm implication, not a production quality
claim: the torso frame still uses proxy depth, and spine and arm channels are
not included.

A facing sweep over 0°, 90°, 180°, and 270° pelvis yaw offsets did not produce
an upright source-aligned character. This rejects a pure yaw calibration as
the fix. The remaining mismatch is a basis or rig-axis convention issue (or
an armature root orientation issue), and must be solved from the rig's full
rest frame rather than by adding a fixed facing offset.

The subsequent Blender inspection found a concrete implementation defect:
`mathutils.Quaternion` takes `(w, x, y, z)`, while the image basis had been
constructed as if it took `(x, y, z, w)`. The resulting basis rotated the
source torso vector into an almost horizontal direction. After correcting the
constructor order, the frame-1 spine target became near vertical (2.2° error
from rest for `spine_lower`) and the rendered white model returned to an
upright, visually plausible pose. This is a code fact for the Blender bridge;
full-sequence quality still requires multi-frame validation.
