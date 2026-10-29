# 膝踝点语义核对（第49–58帧）

## Observed

已把既有人工点、原生投影与ViTPose候选叠加到18个局部放大图，覆盖源49、50、51、52、53、55、56帧的膝踝区域。[只读核对页](../raw/2026-10-29-addams-joint-semantics-v1/review.html)使用黄Y=人工、紫M=原生、青C=ViTPose。

局部图显示：前踢段衣物和运动模糊使部分膝点难以确认是解剖膝中心；踝点经常落在鞋/脚底轮廓附近，不能自动当作踝骨中心。即使三个点接近，也可能属于不同语义（骨关节 vs 鞋底代理），不能用像素差直接排序。

保守分类：18项中膝点均作为`ambiguous_joint_center`，踝点均作为`shoe_or_sole_proxy_candidate`；全部`hard_lock=false`，只允许作为软时序线索，等待区域语义确认。分类是审阅队列，不是模型准确率。

## Direct implication

第49–58帧当前不应直接把旧膝踝坐标送入骨架硬约束或IK。可以利用前后帧的相对移动和已确认的腿身份做软轨迹，但必须把鞋底代理与踝关节分开。第64帧的腾空语义仍独立有效，不由这些膝踝点改写。

## Not yet proven

无法仅从单个裁剪确定所有解剖关节中心；原图分辨率、衣物形变和遮挡会产生不可观测区。当前没有逐点人工确认结果，也没有对每个点测量清晰度/遮挡等级。

## What would verify it

人工只需对18项选择：`joint_center`、`shoe_proxy`、`unusable`，并可一次批量选择同类点；同时确认左右身份。通过的joint_center才进入姿态硬/强软约束，shoe_proxy单独进入脚底接触候选，unusable由前后关键帧插值。随后用留出清晰帧验收，不回填源图像细节。

证据：`docs/agents/raw/2026-10-29-addams-joint-semantics-v1/`，已冻结原图和点位输入。

## Annotation handoff

已将只读核对页扩展为18项本地标注页，每项提供三选一：`joint_center`、`shoe_proxy`、`unusable`。结果先存浏览器localStorage，也可下载`joint-semantics-decisions.json`；默认pending。导出的决定只改变点的语义用途，不修改源图、姿态、相机或IK。页面检查确认包含18个选择控件。
