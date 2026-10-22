# 有效内参与尺度分离：隔离验证

2026-10-22。源相机参数与裁剪记录已确认缺失。

## 目标与边界

- 尝试在独立临时环境运行 GeoCalib，对现有视频完整帧 1/17/23/29/41/55 估计有效内参；模型输出仅为候选，记录版本、权重哈希、画幅及主点假设。失败须记录具体边界，不以旧同模型拟合冒充独立标定。
- 无论模型环境是否就绪，先用现有 image/world 配对数据建立可复现的内参/尺度敏感性基准，为外部候选 K 提供统一验收入口。
- 不改 builder、extractor、renderer、rig、生产轨迹与 H3 输入。

## 假设与成功标准

1. 固定已有训练窗估计的世界到相机旋转，仅对焦距及主点候选逐帧拟合平移。主点中心及横/竖偏移画幅 5% 的 3×3 网格，焦距 600–4000 px 对数 21 点。不是标定值、置信区间或全局最优解。
2. 训练窗≤53。当前内参候选仅按肩/髋/肘/膝八关节的训练残差选择，腕/踝/跟/趾八关节只评估、不参与本轮平移或内参选择。但沿用的旋转原先使用全16点拟合，故这里只是当前步骤的留出诊断，不是严格独立交叉验证。后段仍用自身八点拟合平移，不是轨迹预测。
3. 固定参考长度为训练窗左右髋–膝–踝链长均值的跨帧中位数，仅作单位约定，不是身高/腿长真值。只用一个全局缩放，禁止逐帧归一化隐藏骨长变化。
4. 同一相机下将 world 与 root 同比缩放 0.5/2 倍，验证投影不变；误差≤1e-6 px。这证明尺度规范自由度，不证明距离准确。
5. 回归检查已有 1449 px/中心主点的全16点拟合与原报告一致；保留所有事件帧，输出训练/后段、拟合点/留出点指标和主点/焦距敏感性。报告哪些证据尚缺。

## 路径与命令

- 工具：`docs/agents/tools/recreation2_effective_intrinsics_scale.py`
- 输入：`docs/agents/raw/2026-10-21-world-companion-projection/world-pts-timestamps.json`、`pts-map.json`；已有 `2026-10-22-world-camera-fit/report.json`。
- 输出：`docs/agents/raw/2026-10-22-effective-intrinsics-scale/`；同日 deliverables 报告与 rolling summary。
- 执行：`python3 docs/agents/tools/recreation2_effective_intrinsics_scale.py`
- 验证：输入/工具哈希、帧集、拟合与留出点互斥、尺度闭环、已有拟合回归、`git diff --check`。

## 外部模型执行记录

- GeoCalib 官方 repo SHA: `1dedb29f94fc11b896c5f572005978aeebccd67f`；pinhole v1.0 权重。依赖和模型权重仅落临时目录，不变更项目依赖。
- 推理：`MPLCONFIGDIR=/private/tmp/iframe-geocalib-mpl /private/tmp/iframe-geocalib-env-20261022/bin/python docs/agents/tools/recreation2_geocalib_effective_camera.py --video /private/tmp/recreation2-clip-exact10.mp4 --weights /private/tmp/iframe-geocalib-pinhole-20261022.tar --repo /private/tmp/iframe-geocalib-20261022-retry --out docs/agents/raw/2026-10-22-geocalib-effective-camera`
- 固定K对照：`python3 docs/agents/tools/recreation2_effective_camera_compare.py --camera-report docs/agents/raw/2026-10-22-geocalib-effective-camera/report.json --out docs/agents/raw/2026-10-22-geocalib-effective-camera/pose-comparison.json`
- 模型前五帧共享K仅作候选；第55帧不参与共享估计。GeoCalib重力未接入人体旋转。fx/fy微小差异按完整K处理，有非正方形像素的合成留出闭环检查。
