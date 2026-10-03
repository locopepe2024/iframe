# 人工动作关键帧标注 v2

## Observed

自动 `motion-track.v1` 已能输出 2D/估计 3D 关节，但当前单帧误差无法区分检测误差、坐标映射误差、rig 重定向误差和相机误差。导演台已有状态 review，但还缺少逐关节坐标修正和动作语义标记。

## Direct implication

需要在原始轨迹之上增加只读来源绑定的 `motion-track-annotation-review.v2`。人工修正只覆盖选定关键帧和选定关节，不改写原始轨迹；编译脚本输出独立的 `motion-track-reviewed.v1`。

## 标注内容

- 关键帧编号。
- 关节 `x/y`，可选 `z`；二维坐标必须归一化到 `[0,1]`。
- 人物状态：`tracked`、`manual_recovered`、`detector_missed`、`real_occlusion`、`out_of_frame`、`pending`。
- `facing`、`root_yaw_degrees`、左右脚接触、动作阶段。
- reviewer note。

## 约束

- `source_revision` 不匹配时拒绝编译。
- 未标注帧保持原始内容。
- 不允许未知关节名或超出图像范围的坐标。
- 二维修正沿用原始 `z`；这不代表真实深度已经被人工确认。
- reviewed track 不是最终动作真值，仍需 Blender 投影和连续动作验证。

## 验收

1. 能对代表帧修正肩、肘、髋、膝、踝和脚点。
2. 输出记录 corrected joints、reviewer、annotation digest。
3. 原始 `motion-track.v1` 文件 hash 和内容不变。
4. reviewed track 可继续被单帧验证器读取。

## 当前验证结果

- 使用当前 `motion-track.v1` 的第 1、120、240 帧生成了人工标注样例。
- 成功输出 `motion-track-reviewed.v1`，记录 `manual_recovered`、修正关节、动作阶段、脚部接触和 reviewer。
- 原始轨迹 SHA-256 在编译前后保持一致。
- 修改 `source_revision` 后编译以 `source_revision_mismatch` 拒绝。
- reviewed track 已成功被 `build_single_frame_validation.py` 读取。

## 命令

```bash
python3 tools/motion_track/apply_motion_annotation_review.py \
  --track <motion-track.v1.json> \
  --annotations <motion-track-annotation-review.v2.json> \
  --reviewer <id> \
  --output <motion-track-reviewed.v1.json>
```
