# 复刻项目内动作标注 v1

目标：将独立HTML的逐帧关节审阅变成复刻“分析”页内的能力。选择任意源PTS帧、调整双髋/膝/踝、标记可见性及接触，并保存到认证用户项目。支持刷新恢复；不绑定Addams诊断路径。

边界：本版本提供真实源帧提取、人工标注和持久化，不自动宣称已完成姿态估计或三维重算。无模型预标注时不捏造模型点。帧提取用源帧索引与PTS，保持画幅比例，最大边960。保存以媒体ID/SHA、analysis_id、PTS、独立frame revision核验；标注版本不改变项目timeline revision。旧analysis记录保留但不显示成当前结果。

接口：GET pose-review（当前已存帧）；POST pose-review/frame（analysis_id、源pts）；PUT pose-review/frame（帧身份、revision、人工关节、contact/status）。保存仅接受当前analysis同项目源帧，拒绝跨owner、过期图像/版本及无效坐标。接触和遮挡是审查记录，不是真实3D。

前端：RecreationPage Analyze区按需打开，避免未使用功能时额外请求。SVG叠加于真实尺寸图像，点击/拖动和键盘微调，显式保存；切换帧或关闭未保存编辑时提醒。标注保存失败保留草稿；项目切换重置组件；保存后可浏览已存帧，导出带来源的JSON。

验收：真实FFmpeg提帧与SHA/尺寸核对；保存后恢复；版本冲突、analysis变化、跨项目/owner和越界拒绝；UI选择/调整/保存/恢复/失败保留草稿；typecheck及既有复刻测试通过。无三维结果时明确说明尚未重算。

## Implemented and verified

入口为复刻 → 分析 → 动作标注。支持任意源帧、六关节点位、可见性、脚接触、双腿相对前后关系、项目内保存/恢复及JSON导出。左腿青色、右腿橙色；隐藏/不确定段使用虚线，颜色以外保留文字标签。初次无预标注时由用户点选，不把默认位置冒充模型预测。

保存只改独立帧revision，保留owner/user、原视频SHA、审阅图SHA、analysis、源PTS/time_base和图像尺寸。原HTML未改；标注接口不接受其硬编码Addams任务直接覆盖其他项目。

验证：前端typecheck通过；PoseReview及RecreationPage共15项交互测试通过；后端新增4项真实FFmpeg/持久化/API测试通过，既有recreation测试47项通过、1项跳过。未做浏览器端到端实测或部署。

限制：前后关系是人工审查记录，不是绝对深度；未运行深度模型。尚未把项目标注接入三维求解任务、rig四元数导出或白模渲染，界面明确提示未重算。不可把该状态显示为动作复刻完成。
