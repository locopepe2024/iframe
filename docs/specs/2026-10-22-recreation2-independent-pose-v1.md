# 独立二维姿态观测对照

2026-10-22。固定暂定有效K=GeoCalib共享1601.142px，不调整焦距，不改主链路。

## 目的与边界

先验证MediaPipe二维观测是否有独立识别器支持。RTMPose官方body7权重（M模型，256×192）通过RTMLib/ONNX Runtime CPU推理，无需SMPL。此模型只产生二维关节，不是独立3D恢复，也不恢复焦距。作者RTMLib公开body配置已核对，权重指向OpenMMLab官方。

输入完整源帧1/17/23/29/41/55和后段195/197，按既有PTS/解码序号核对；既有MediaPipe target_bbox只用于固定目标身份及top-down ROI（后续79帧核对确认是全部33关节点min/max包围框，不是独立检测器框），不使用其关节点作为RTMPose输入。ROI由MediaPipe提供，二者不能称完全独立；额外同中心0.9/1.1倍bbox宽高，全部保留，不选最好结果。脚跟/鞋尖不是COCO17，禁止伪造映射。

## 验证

输出COCO17完整图像坐标、模型分数及12共同身体点差异；明确“模型分歧”不是真值误差。保留全图叠图与腿/臂裁剪供人工查看；比较RTMPose ROI敏感性及MediaPipe局部骨长异常帧。对既有MediaPipe world固定相机/重拟合八点root，再用独立RTMPose二维12点观测做交叉评分（四腕踝不参与当前root拟合），仅诊断，不对焦距选优。历史旋转仍有MediaPipe全点参与，不是严格交叉验证或独立3D真值。

记录源视频、模型包/ONNX、库/工具、图像与输入证据哈希；确认输入RGB/BGR与官方预处理、坐标回映行为。源码/模型不可用则记录实际故障，不用随机权重冒充。运行完成后语法/diff/数值验证，精确路径提交。

## 路径

工具docs/agents/tools/recreation2_independent_pose.py；raw/2026-10-22-independent-pose；同名deliverable，rolling summary。模型/外部代码/环境只在private/tmp。不替换生产依赖，不发布。

## 运行时契约与探索项

权重ZIP pipeline.json要求to_rgb=true；RTMLib0.0.16接口本身不换通道，因此显式将cv2 BGR转RGB后调用，按权重包契约执行。ONNX batch为动态，保留固定CHW=3×256×192检查，不要求batch维写死1。源图+ROI平移检查通过。

观察197明显分歧后追加左右互换评分，仅作为后验探索项，不自动翻转轨迹、不根据互换结果选择标签。以同片图像人工查看核对，既不把RTMPose当真值，也不将其2D一致性认定为3D正确。
