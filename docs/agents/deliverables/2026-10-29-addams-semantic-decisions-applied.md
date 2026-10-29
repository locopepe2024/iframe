# 用户语义选择应用结果

## Observed

已读取并冻结 `/Users/owen/Downloads/joint-semantics-decisions.json`，输入schema v2，18项均有选择。结果只写入证据层 `applied-decisions.json`，没有修改源图、姿态、相机、地面或IK。

| 选择 | 数量 |
|---|---:|
| joint_center | 11 |
| shoe_proxy | 7 |
| 坐标来源 vitpose_c | 11 |
| 坐标来源 human_y | 5 |
| 坐标来源 native_m | 2 |

在11个`joint_center`项中，8个使用ViTPose、3个使用人工点；没有任何joint_center项采用原生投影。7个shoe_proxy项中，3个使用ViTPose、2个人工点、2个原生投影。

对11个joint_center项，沿用既有人工 review 点作暂时对照（不是独立真值）：原生投影误差中位数36.10px、均值45.06px；ViTPose误差中位数21.72px、均值23.54px。该差异与用户对ViTPose在这些帧更好的判断一致，但不能推广为全片准确率。人工坐标没有相同模型误差指标；shoe_proxy不使用关节中心误差评价。

## Direct implication

这18项可以进入下一步“软锚点”处理：ViTPose选择的joint_center作为姿态候选，人工/原生/ViTPose选择的shoe_proxy只进入脚部几何候选，不能互换语义。所有项仍`production_hard_lock=false`，需要通过时序留出验证后才能升级。

## Not yet proven

既有人工点可能是轮廓或代理，不是独立真值；同一人工点既被用于比较又参与用户选择，存在选择偏差。ViTPose优势只在这11个局部点、当前片段和既有对照口径中成立；没有测试未标注帧、遮挡区、转身后段或独立清晰帧。

## What would verify it

下一步将这11个joint_center作为候选软观测，把7个shoe_proxy分开用于脚底/接触轨迹；在46–65同镜头连续窗口中做时序拟合，并留出未参与选择的清晰局部帧。比较ViTPose候选、原生候选、前后帧插值三组在连续性、骨长、左右身份和投影上的表现。通过后才考虑更新白模动作；不把当前统计直接写入主链路。

证据：`docs/agents/raw/2026-10-29-addams-joint-semantics-v1/applied-decisions.json`。
