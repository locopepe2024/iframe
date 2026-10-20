# recreation2 固定输入肢段长度与跨帧深度分支对照

2026-10-20。状态：隔离实验已完成；仅诊断，主 builder/rig/服务不改。

## Boundary and assumptions

固定 scaled_camera 候选的镜头、Y=792/1394、自身骨基底、原始 root/yaw、骨盆关闭、IK关闭及PTS。原始XY与评分输入不变。目标rig本来已经固定骨长；本轮约束的是输入proxy的八个四肢段，不是修改rig。

先做风险切片：每条左右手臂/腿的近端肩/髋Z固定，仅调整中间及远端关节Z。每类双侧共享一个长度，取全段双侧三维proxy长度中位数与最大二维长度的较大者；后一条件保证固定XY下几何可行。该长度只是图宽归一化proxy单位，不是源人体公制骨长。固定长度+固定XY使每段深度差只有正负两个分支，每条两节链每帧枚举四种解。

三组：原始XYZ；逐帧选最接近原始Z的固定长度解；整段联合选固定长度解。跨帧组用二阶动态规划精确枚举，目标为中间/远端Z相对原始的平方残差（尺度0.05）加非均匀PTS下相邻速度差乘中位采样间隔的平方残差（尺度0.03）。这些是预设诊断尺度，不扫权重/不按输出误差选解。源visibility不是深度误差方差，暂不拿它标定权重。

这不是完整透视bundle adjustment：固定proxy长度假设忽略真实透视下的随距离缩放；躯干/骨盆、足部骨、地面、接触和关节角限位均未求解。不得以本轮成败判定成熟多帧重建算法的上限。

## Verification

1. 合成两节链与穷举核对动态规划最优值；验证长度精度及XY/近端Z不变。
2. 原始组逐值复现scaled_camera；所有组root/yaw/key不变，原始输入哈希不变，renderer重导入<0.01px。
3. 报告28独立源样本×12关节、六个预选事件1/17/23/29/41/55、48输出帧、肢段投影长度/方向、踝尾部误差、鞋底patch速度及动作幅度；不以单项中位数接受。
4. 若整体/踝尾部或事件明显恶化，拒绝成为主链路修复，记录失效边界；不放宽原H3/接触门槛。

## Paths and commands

- `docs/agents/tools/recreation2_fixed_length_targets.py`：输入proxy约束及合成核对。
- `docs/agents/tools/recreation2_fixed_length_temporal_probe.py`：复用隔离重定向和重导入验证。
- 远端 `/tmp/iframe-rig-space-20261019/fixed-length-temporal-v1/` 运行 Blender；结果回收至 `docs/agents/raw/2026-10-20-fixed-length-temporal/`。
- `python3 docs/agents/tools/recreation2_fixed_length_targets.py --self-test`

## Result

三组控制通过：原始组逐值复现scaled_camera，root/key相同，renderer重导入均0px。固定长度+跨帧组全关节误差中位数10.62→8.58px、踝18.55→12.27px、最大步长51.72→25.96px；六事件均改善。逐帧固定长度组最大步长反升61.77px。部分幅度仍过大/不足，源55骨盆及真实脚接触未验收；不提升主链路。[报告](../agents/deliverables/2026-10-20-recreation2-fixed-length-temporal-v1.md)。
