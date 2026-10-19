# 接触取证与异常步长分解

范围：不修改生产和既有候选；源1/17/23/27/29/31/33/35/37/41/43/45/47/49/51/55原始帧裁剪复核鞋底/反光/舞台线，保留支持、不确定与鞋缘接触区别。人工标注仅为二维可见关系，不当作受力或公制地面真值。

诊断：在既有weight0完整bundle上采48帧，定位输出28与33帧的最大关节步长、固定鞋底patch移动。以当前root作用于上一帧root-local patch得到root-only位移，再与实际位移相减得到局部姿态分量；两项应精确相加回总量。二者含相机/坐标代理假设，不等于真实世界运动。

输入：pinned rig、既有无骨盆/root baseline、固定patch索引、源track、PTS anchors。脚本`docs/agents/tools/recreation2_motion_spike_probe.py`；产物`docs/agents/raw/2026-10-19-contact-evidence/`。沿用远端隔离临时目录，源码/rig/服务不改。

验收：源帧提取使用明确select及passthrough，记录原片SHA256；根/局部位移分解重建误差<1e-6 units；所有投影与既有640×360相机一致。将源二维关节变化与proxy深度单列，不以数值变化直接证明深度噪声或真实相机运动。未独立校准地面前不冻结动作合格阈值。
