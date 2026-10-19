# Two-bone IK 最小验证

范围：独立 agent probe，在固定 pinned rig、既有无骨盆/root bundle、源 PTS 锚点上验证数学两节骨 IK，不修改主 builder。

前置检查：`ankle → lower_leg → upper_leg` 是实际腿链。Blender 在 ankle 上设置 chain_count=2 会选中 ankle 和 lower_leg；上轮没有验证实际链，也没有清理跨帧积累的约束，故不能将其结果归因于 pole vector。新实验直接解 hip/knee/ankle 的位置，避免把未知接入当作求解失败。

鞋底：静止姿态筛选每侧脚部蒙皮底部顶点带，并固定顶点索引；后续评估同一 patch，避免每帧最低点切换。它是几何代理，不宣称真实受力点。用首帧左脚 patch 的平均 Z 作为自洽目标平面，仅用于求解测试，不是源舞台公制真值。单位先称 Blender units，未验证资产公制尺度。

求解：保持 root、骨长、原膝弯曲侧与踝/脚世界朝向，用余弦定理解两节腿；超出可达范围显式记录，并检查端点残差。独立样本之间重新载入姿态/清理动画，不积累约束。支持脚候选为源1/17/23/29/41的语义left、源55的语义right；源29不锁仍在摆动的right，源55标签依据源踝点序列及已有画面候选，未定为真值。

成功标准：零位移请求保持姿态、骨长不变、可达端点误差 <1e-4 units；序列化后 renderer 重导入投影差 <0.01 px。另报告实际鞋底 patch 高度与12关节投影；几何测试通过不代表源动作验收通过。源帧1/17/23/29/41/55，渲染可选。

脚本 `docs/agents/tools/recreation2_two_bone_ik_probe.py`，临时远端 `/tmp/iframe-rig-space-20261019/`，输出本地 `docs/agents/raw/2026-10-19-rig-space-calibration/two-bone/`。命令接受 --rig、--bundle、--track、--anchors、--out、--render。诊断输出至少包含单位边界、可达性、端点残差、patch残差、重导入残差和源关节误差。
