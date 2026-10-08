# 全剧与单集 Director 优化交接摘要

日期：2026-10-09
状态：规范与兼容展示已完成；长文本结构化分析和真实上下集交接尚未实现

## Observed

- 当前全剧分析把投稿前言与各集正文拼接输入；全剧 `story_map` 在归一化后被清空。全剧页面仍以 JSON 文本框审阅草稿，不能证明逐集事件、来源范围和跨集状态覆盖。
- 单集 Director 已有可视编辑、草稿与已采用 revision；本集分析可读取已采用的 Series Director 作为只读背景。Series revision 变化会提示本集复核。
- 系列分集概览曾因 `original_text` 未映射到 `originalText` 误显示“暂未添加剧本内容”；该字段映射已修复。概览不再把原文前 300 字称为剧本概要。
- 已新增可选的 `Script.episode_understanding` 契约。采用本集 Director 后写入 `confirmed` 状态、`episode_summary` 和 Series/Episode revision；未产生真实分析的 `incoming_handoff`、`outgoing_handoff` 保持空值。

## Direct implication

- `chunk` 只负责长文本计算与来源定位，不是创作者阅读的分集概要。分集页面应展示 Series 背景、本集理解和上下集交接，并将原文留在编辑器。
- 全剧理解负责跨集骨架、人物/关系状态、故事线、连续性与冲突；单集理解负责本集实际事件、场景、入场和离场状态，以及传给下集的开放项。
- 已采用 revision 是下游事实边界。草稿修改不应静默改变拍摄计划、分镜或其他集；Series 更新只标记受影响的 Episode 需要复核。

## Not yet proven

- 当前 `execution_summary` 只是旧 `DirectorProfile` 的有界兼容投影，不等于完整的 `episode_summary` 或跨集 handoff。
- 目前没有带 `episode_id`、集内 source range、稳定 event/ref 和覆盖校验的 Series/Episode IR；不能宣称已解决长剧本中段遗漏或上下集连续性。
- GitHub 项目研究提供阶段产物、版本失效和人工审阅点等架构模式，未证明其界面体验或模型分析质量优于当前产品。

## 后续实施

1. 建立版本化来源目录：梗概、人物小传、每集正文和用户要求分开；chunk 保存集内来源范围，不成为 UI 主内容。
2. 每集先归并为 `episode_summary`、`incoming_handoff`、`local_progression`、`outgoing_handoff`、`source_refs`；全剧再按集归并人物状态、故事线和冲突。首集 incoming 为全剧初始状态，末集 outgoing 可保留开放结尾。
3. 全剧默认展示可读报告和分集推进；每条结论能回到对应集与原文。单集概览显示已采用 Series revision、本集理解状态及上下集承接。JSON 仅作为高级视图。
4. 人工审阅草稿、来源和 Director diff 后一次采用；不同 revision 的影响范围、stale 状态及下游复核动作要可见。
5. 用两集跨集伏笔 fixture 和长文本样本验证来源覆盖、状态传递、版本隔离和实际模型稳定性；通过 schema 不等于语义正确。

主要规范：`docs/specs/2026-10-09-series-episode-director-understanding-structure-v1.md`。本轮提交：`65d1558d`、`9b707546`、`bfc1fd48`、`da737752`、`49ca464b`、`d14d6596`。
