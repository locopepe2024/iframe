# 3D 导演台动作验证产物

这是 Director 3D 离线白模动作验证产物，可直接从仓库下载或预览。

- `alternating-cycle-review.mp4`：Walk_Loop 33 帧，全身与脚部并排视图。
- `alternating-cycle-sheet.png`：抽帧检查图。
- 运行环境：media Blender 4.5.9，场景评估 24 FPS。
- 试验内容：左右脚交替支撑 IK，左脚 0–8 帧、右脚 16–24 帧。

路线位移是根据原动作脚底轨迹拟合的数值试验输入，不是人工审核后的世界路径。视频用于动作参考和问题定位，不能证明无滑步、真实接触或可直接进入生产动作库。完整数值证据见 [`whole-cycle-contact-review-2026-10-30.md`](../../../docs/examples/director3d/whole-cycle-contact-review-2026-10-30.md)。
