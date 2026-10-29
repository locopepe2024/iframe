# 快跑腾空与接触门控局部验证

## Scope and evidence

只验证源58–65帧，25fps。用户指出快速奔跑有瞬时腾空，既有人工标签58/62=left、64=airborne。连续原图可见脚部离地变化，但仅凭投影不能反求真实离地高度。64为既有标注加用户动作解释；不把全段自动标成跑步支撑，也不自动向相邻帧延长airborne。

代码检查：既有target-contact-ablation只选择49/52/53，不包含64，所以不能归因“现有生产IK压掉64腾空”；此次是在隔离候选上验证误用持续脚锁的后果。基于media Blender 4.5.9的inferred-world-camera-candidate，固定rig/相机/帧映射/原始根节点动画。地面取同一候选58/62左脚sole minimum的中位数，仅为对照平面，非真实地面标定。

## Conditions

- none：既有恢复，无新IK。
- stale-left：错误示范，延续58/62的左支持，58–65全部启用左脚高度IK。
- explicit-phase：只在已有明确左接触58/62启用；64双脚关闭；其他未确认帧unknown且不加接触锁。左右未知并不等于腾空。此轮不改未确认标签。

同一状态每次重载原blend，每格无求解器状态污染。使用下腿两骨IK、踝部WORLD旋转保持。测两脚最低蒙皮点到对照平面距离、踝与骨盆位移、腿/脚蒙皮变化、IK权重；检查64解除IK是否与none几何相同。必要时渲染源/none/stale/explicit的64对照，保存诊断blend但不改主链路。

## Success and limits

门控正确：显式airborne的双脚IK均0，unknown不凭默认支持加锁，source64的所有model副本均解除。几何：64 explicit与none最大顶点差<1e-5米，根/骨盆不变；若原恢复穿地，必须报告而不是声称解除IK即修好腾空。展示stale锁的位移量不等于证明历史生产已发生该错误。无新网络模型调用。

Commands: 本地门控测试；scp诊断脚本及模块到media；media Blender --background --disable-autoexec运行；取回报告/PNG；只提交专属spec/工具/结论。

## Follow-up diagnostic

首轮门控通过，但64原恢复左脚低于对照面约2.86cm、右脚高于11.13cm。追加单帧根部竖直平移敏感度：与原恢复保持相同内部骨架，分别令最低鞋底达到对照平面0/1/2cm（这些是诊断间隙，不是反求源高度）。记录需要的平移、投影变化和骨架相对几何不变性，不生成未经验证的全段抛物线。另比较nearest模型采样与源64精确PTS对应的Blender子帧，排除仅由25→30fps时间误差引起的假象。

执行完成：本地五项测试、media Blender三条件门控检查通过。用户复核64确认为双脚腾空、右脚尖更高左脚尖近地。精确PTS子帧仍左鞋底低于诊断平面2.64cm；仅解除IK不能修复原恢复高度。单帧整体根平移敏感度已完成，不作源真实高度或连续动画质量声明。报告：docs/agents/deliverables/2026-10-29-addams-running-flight-validation.md。
