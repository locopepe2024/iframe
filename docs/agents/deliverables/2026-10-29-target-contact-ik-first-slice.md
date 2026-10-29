# 目标rig与接触IK：第一轮测试

> 本轮指标已被后续坐标审计降级为历史诊断：原候选的相机上方为−Z，直接按+Z-up/min-Z验收接触无效。最新结论见 `2026-10-29-world-camera-contact-ablation-v2.md`。不得将本页极低接触误差作为通过依据。

## Observed

运行于media Blender 4.5.9；只生成诊断资产。

代码事实：旧脚底搜索区域重叠，右脚forefoot选到了左脚顶点。已切换REST状态下按最近踝点划分，v2输出左右各519点；同侧、集合互斥和代理坐标往返检查通过。完整FK回放和视觉审查仍待完成。

运行观测：以原迁移动画、源49/52/53三个已标注支持帧做两组对照。

| 地面假设 | 49帧踝移动 | 52帧踝移动 | 53帧踝移动 | 结果 |
|---|---:|---:|---:|---|
| 原始目标资产rest地面 | 73.21cm | 79.73cm | 82.48cm | 拒绝 |
| 三帧目标脚底高度中值 | 0.38cm | 28.10cm | 31.94cm | 整组拒绝 |

两组最终接触点XY偏差<0.05mm，脚底高度绝对偏差<0.02mm，非支持踝位移0。但这是约束可满足性的指标，不能证明动作正确。工程诊断踝移动上限暂定5cm。

## Direct implication

只让脚碰到地面不足以验收。更换地面原点可显著降低49帧校正量，但52/53帧仍不满足局部校正要求。地面原点不是唯一未解决因素。

## Not yet proven

未证明28–32cm差异全来自根轨迹、脚滑或姿态恢复；同一网格顶点持续锁定本身也可能不符合脚掌滚动。未验证连续支撑速度、膝盖朝向、垫脚或源画面投影改善。中值地面不是源真实地面。

## Hypotheses

候选包括根运动迁移不一致、目标姿态/父空间不匹配，以及支持窗内接触点转移。当前样本不能确定主因。

## What would verify it

下一步无锁定/仅高度/仅XY/完整锁定四组消融，记录根节点、骨盆相对踝位移与网格接触点；确认固定支持段后再测滑动。先沿用已有标注，不扩大逐帧人工工作量。

方案：`docs/specs/2026-10-29-source-to-blender-test-optimization-plan-v1.md`。
证据：`docs/agents/raw/2026-10-29-addams-native-layered-v1/target-rig-contract.json`、`target-contact-ik.json`、`target-contact-ik-support-median.json`。
复现：media上运行`addams_target_rig_contract.py`后运行`addams_target_contact_ik_probe.py`；第二组加`-- --support-median`。首组旧报告`target-contact-ik.json`保留原始结果，新脚本按ground_mode命名输出。
