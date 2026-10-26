# 目标鞋底 patch 与源二维鞋底代理对照

## Observed

media Blender 4.5.9 在 pinned rig 上投影了 `ankle`、`foot`、`toe` 和固定网格 patch；源点使用已有 MediaPipe `heel/foot-index` 中点，并按 1394×792 → 640×360 缩放。该源点是二维图像代理，不是鞋底真值。

对应支持侧的 patch 误差（px）：

| 源帧 | 语义侧 | ankle | foot | toe | patch |
|---|---|---:|---:|---:|---:|
| 17 | left | 1.88 | 9.73 | 21.32 | 25.98 |
| 23 | left | 3.60 | 4.80 | 16.01 | 20.80 |
| 29 | left | 13.77 | 21.44 | 32.61 | 37.13 |
| 41 | right | 14.27 | 21.73 | 31.08 | 30.46 |
| 55 | right | 27.79 | 35.97 | 42.95 | 37.43 |

第1帧作为控制时，左侧 ankle/foot/toe/patch 误差分别为3.27/10.86/23.43/28.57px，右侧为10.93/4.57/10.35/11.09px。说明单一源 heel/toe 中点并不能同时代表目标 rig 的同一语义点。

若在支持段入口用二维平移吸收 patch 与源代理的初始偏移，left 17→23→29 的剩余偏差中位/最大约6.54/11.33px；right 41→55 约15.75/31.51px。它不是一个稳定的全段固定偏移。

## Direct implication

当前源二维代理更接近目标 ankle 或 foot head 的投影，而不是固定网格最低 patch；但这只能说明图像代理之间的几何不一致，不能证明 ankle 是物理接触点。patch 与源代理的残差随事件段变化，不能通过一个静态鞋底偏移解决。

这也解释了此前“patch IK 第29帧改善、第23帧变差”：目标 patch 的接触语义尚未与源观测建立同点对应，IK 几何正确不等于源鞋底投影正确。

## Not yet proven

源 MediaPipe heel、foot-index 是否落在鞋底真实接触边缘；目标 patch 是否应取后跟、前掌或鞋底可见下缘；源相机、深度、根轨迹和地面高度均未被该二维对照辨识。不能以该表选出生产接触目标或宣布 H3 合格。

## Hypotheses

最大剩余问题更可能是“源观测点语义”和“目标网格接触点语义”不一致，并与腿部深度/姿态误差交互；不是单纯把 ankle 换成 patch 就能修复。

## What would verify it

下一步应在源图像上标注可见鞋下缘容差带（不强行标后跟），再把目标 mesh 的最低下缘、前掌、后跟候选分别投影到同一容差带；只用支持入口校准平移，检查后续误差、地面穿透和整身投影。若仍无法稳定对应，保留 ankle/patch 双重不确定性，停止把二维代理转成世界锁脚。

H3动作延迟按用户提供状态已解决；本轮未运行H3，无主链路、rig或builder修改。

[完整结果](../raw/2026-10-26-patch-projection/report.json) · [探针](../tools/recreation2_patch_projection_vs_source_sole.py) · [规格](../../specs/2026-10-26-recreation2-patch-projection-vs-source-sole-v1.md)
