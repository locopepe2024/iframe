# Addams固定骨长局部旋转与回投

## Observed

media Blender4.5.9实际处理源6–24共19帧，使用已固定SHA的neutral-female诊断rig（不是原706骨L3控制rig）。只改变upper_leg/lower_leg四通道，root、骨盆和其他骨骼不拟合，不做IK。源MP三维轴按x,y,z→Blender x,z,−y映射；该朝向选择是诊断假设。

四条骨段世界方向与输入方向夹角最大为0°（Blender angle函数精度内），骨长最大变化1.871e−6units，大腿tail到膝head连接差最大4.215e−8units。证明该rig上当前四骨方向映射按输入执行，不是源姿态准确性证明。

采用正对的任意正交诊断相机投影，再对每帧六个髋/膝/踝点拟合正uniform scale与二维平移（无旋转）。拟合与评分使用同六点，是乐观的样本内对齐，不是源相机标定。19帧六点平均残差的中位数15.74px，最大29.43px（960×520）。

目视叠图仍见髋点、腿段分配和抬起腿残差；尚无人工区域真值，不据此选定某模型或物理骨长。

## Direct implication

本次映射能执行输入方向并保持固定骨长，但“固定骨长+MP三维方向+冻结骨盆+诊断正交投影”不能同时精确复现其二维六点。这个组合的残差不能再全归因于四骨旋转执行失败。

## Not yet proven

没有分离源3D方向、rig比例、冻结骨盆、轴映射与相机投影各因素。正交投影不能排除透视改善；二维对齐不等于恢复world root。只做四通道，不能作为完整白模复刻结果或H3参考。没有接触/落地验收，也没有证明原L3 rig可用。

## What would verify it

固定这19帧作为局部实验输入，下一项用显式透视候选重拟合每帧平移，再分别观察髋/膝/踝残差；保留原始3D方向，不靠随帧改变骨长消残差。之后独立比较骨盆朝向和比例假设，禁止同时改全部变量。进入原L3 rig之前需核对版本兼容、控制骨与变形骨映射。

可编辑诊断文件保存在media `/tmp/addams-pose/fixed-rig-diagnostic.blend`。本地保存四通道bundle、世界方向和诊断投影数值；没有改生产提取器或导演台运行时代码。

[回投对照图](../raw/2026-10-28-motion-asset-package/addams-fixed-rig/projection-review.jpg) · [Blender数据](../raw/2026-10-28-motion-asset-package/addams-fixed-rig/fixed-rig-report.json) · [回投指标](../raw/2026-10-28-motion-asset-package/addams-fixed-rig/projection-review.json)
