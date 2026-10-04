# 复刻校准基线与下一切片

## 已确认基线

- 生产前端 DEPLOY_COMMIT：c38c5a7b。
- 生产后端 image revision：c38c5a7b274637d497901ee4473772d81ab65da9。
- 独立开发分支：fix/recreation-calibration-c38c5a7b。
- 用户确认 3D 导演台及全景提交已合并部署，本任务不重新处理已合并 PR。

## 代码事实

现有 MotionTrackImporter、MotionTrackReviewPanel、motion-track-review.ts 支持源轨迹导入、review overlay、候选选择、备注、独立撤销及审核编译。后续沿用此状态 owner，不再加入独立的人工标注面板和另一套草稿存储。

当前编辑表单的 current 优先取 manifest.frames，再取 editedFrames；markers 则优先取 editedFrames。两者读取优先级不一致，需要行为测试验证并修复。

历史复刻分支中的单帧校准、人工标注 v2 工具未直接存在于本基线，不能将历史推送等同于已上线。需要逐项审查后迁移，不整分支合并。

## 下一切片与验收

1. 修复编辑表单优先读取 overlay；验证备注、状态、候选修改立即显示，撤销恢复。
2. 在现有 review panel 接入逐关节修正，沿用 setMotionTrackJointOverride 等已有 owner action，先核实实际 action 名称。保留源轨迹只读、revision 校验及原始估计深度证据。
3. 绑定源帧与白模投影证据：源关节、evaluated 骨端点投影、左右标签、残差线。不得把检测坐标当人工真值。
4. 固定坐标口径：显式图像尺寸、像素纵横比、相机 forward/up、拟合前后结果及拟合旋转角。拟合后误差不能证明全局朝向正确。
5. 先标注 8–12 个真实关键帧再比较自动轨迹与人工修正轨迹；无人工标注时不宣称动作精度改善。

## 边界

- 主线工作树已有其他任务修改，使用独立 worktree。
- 不直接部署；验证后提交管理员。
- 不改 catalog/provider，不发起付费视频任务。
- 先完成动作复刻，再补字幕与音频。

## 当前切片完成

- 行为测试先复现：输入新备注后 UI 仍显示 original。
- 修复表单及四个写入 action，优先读取 editedFrames，连续修改状态、候选、坐标、备注不丢失已有 overlay。
- 新增关节二维编辑，肩/肘/腕/髋/膝/踝/脚跟/脚尖按单关节编辑；显式点击应用，拒绝空值和超范围坐标，保留原有 Z，缺失深度不伪造。
- 支持既有人工审核撤销，源 manifest 不变。
- 验证：3 个 UI 行为测试、5 个 review/草稿测试通过；typecheck 通过（首次自动 bootstrap Next.js 静态构建成功）。
- 源帧/白模投影对照、文件下载与真实素材人工标注尚待后续切片，不宣称当前已通过真实动作质量验收。
