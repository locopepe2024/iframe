# Addams三维候选输入检查

## Observed

media重复运行同一MediaPipe Full VIDEO流程并补存pose_world_landmarks。50帧检测有无与原运行一致，重复二维点最大差0原图像素。源6–24（PTS0.20–0.92秒）19帧均有三维候选。

这些坐标是髋中心附近的模型三维估计，不能当作全局人物轨迹或标定后的场景尺度。腿段三维长度最大/最小比：左大腿1.700、左小腿1.733、右大腿1.528、右小腿1.272；不是二维投影长度，因此在当前候选中不能直接作为稳定刚性骨长使用。没有证明是模型、遮挡或卡通比例中的哪项导致。

media已检查：命令路径未找到nvidia-smi，隔离环境未安装torch/smplx；不能据此运行此前已审计依赖CUDA和SMPL资产的GVHMR/WHAM官方流程。未尝试更改这些后端以假装CPU等价运行。仅补存现有MediaPipe模型输出，不是新的世界动作恢复后端。

## Direct implication

没有缺测不等于三维稳定。不能把19帧原始三维点直接逐帧当作可变骨长白模。固定骨长rig需要方向/旋转映射和独立回投验收，且全局root、相机与接触必须另求。

## Not yet proven

没有独立3D真值、真实K、世界root、接触或rig动画验收。未运行GVHMR/WHAM；原始MediaPipe三维候选不能替代其世界恢复结果。

## What would verify it

下一项在固定rig骨长下只求局部旋转候选，保留相机/root未知状态并检查二维回投与方向误差。需要世界恢复时，使用符合既有后端契约的CUDA主机和模型资产，先实测同一短段；不让固定骨长或平滑操作掩盖源估计不稳定。

[三维原始候选](../raw/2026-10-28-motion-asset-package/addams-pose-media/world-candidate.json) · [19帧摘要](../raw/2026-10-28-motion-asset-package/addams-pose-media/world-segment-summary.json)
