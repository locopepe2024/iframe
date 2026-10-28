# Addams独立检测与单帧模式隔离

## Observed

media主机实际运行YOLOX-M HumanArt（RTMLib默认score_thr=0.7）+原RTMPose-M，前50帧全部至少产生一个检测框及姿态候选；46帧单框，37/38/43/49帧双框。所有候选原样保存，没有自动选择人物或合并框。

同一MediaPipe Full权重在IMAGE模式下：源1/5仍无结果，6/48/49/50有结果；此前连续VIDEO模式49帧缺测。单帧模式49可推断，说明该帧并非在所有推断模式下都无法识别。该对照同时改变跟踪状态与检测触发，不能唯一归因于跟踪代码bug。

独立检测器使RTMPose在此前MP缺测的1–5/49帧也产生候选，但人体近景裁切和检测双框仍未通过质量验收。检测成功不等于完整人体恢复成功。

## Direct implication

解除MP区域依赖可避免一模型缺测导致整个二维链路停摆。IMAGE模式适合作为隔离诊断；不得静默覆盖VIDEO原始缺测。独立检测出现双框，后续需身份/重复检测审查，不能将检测框数量等同于人物数量。

## Not yet proven

没有核对50帧独立候选的关节准确性或人物身份；双框是否重复/误检尚未逐框目视验证。无3D、接触、焦距或rig验收。

## What would verify it

将37/38/43/49双框及其骨架分别叠图，验证是否同一人物的重复/局部框；保留所有原始候选后再定义确定性选择规则。对49帧对比IMAGE、VIDEO和独立RTM关节，不能只按是否有结果选择模型。

[原始结果](../raw/2026-10-28-motion-asset-package/addams-pose-media/independent.json) · [运行脚本](../tools/addams_independent_detector_probe.py)
