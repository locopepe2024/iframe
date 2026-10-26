# 源可见鞋下缘候选：阈值敏感性仍过高

## Observed

在已核对源视频上，对事件帧 1/17/23/29/41/55 的左右鞋 ROI 做四个亮度阈值的连通区域下缘候选。该方法只寻找“可见亮鞋体”，未标定物理接触面。

阈值变化造成的最低 y 范围：

- 第17帧：left 19px，right 57px
- 第23帧：left 22px，right 3px
- 第29帧：left 22px，right 23px
- 第41帧：left 4px，right 11px
- 第55帧：left 21px，right 31px

较大的变化来自鞋体、反射和地面亮线的连通关系变化。右脚第17帧和第55帧尤其不稳定；这些区域不能直接生成二维接触容差带。

## Direct implication

仅靠亮度分割不能稳定确定源鞋下缘。阈值越过反射/地面线后，候选最低点会发生十几到几十像素跳变；不能用“最低亮点”替代人工鞋缘或可靠分割。

这进一步支持保留源鞋接触不确定性：目标 rig 的 patch 几何已经可测，但缺少稳定源图像对应点，不能把 patch 误差归因于单一接触偏移。

## Not yet proven

尚未证明亮度分割失败代表源鞋缘无法跟踪；颜色、边缘、光流或人工标注可能提供更好证据。也未证明源人物真实滑步或目标 patch 错误。

## Hypotheses

当前最大障碍是源鞋与反射地面在图像中共享高亮结构，导致可见鞋体和接触线语义混淆；这比“选择 ankle 还是 patch”的几何选择更早发生。

## What would verify it

使用人工标注的可见下缘容差带作为小规模真值，或建立颜色/边缘/时序跟踪并保留失败帧；只在稳定帧施加二维投影约束，不对遮挡后跟做强行推断。

H3动作延迟按用户提供状态已解决；本轮未运行 H3，也未修改主链路。

[逐帧 JSON](../raw/2026-10-26-shoe-edge-candidates/report.json) · [候选图](../raw/2026-10-26-shoe-edge-candidates/edge-candidates.png) · [工具](../tools/recreation2_source_shoe_edge_candidates.py) · [规格](../../specs/2026-10-26-recreation2-source-shoe-edge-candidate-v1.md)
