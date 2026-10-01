# Director 结果接收与可修复校验 v1

## Observed

- 上游模型已经返回完整文本时，当前 worker 仍会直接执行严格 `DirectorProfile` 校验。
- 局部模型差异（非标准状态、额外元数据、未知角色引用、缺少可后补描述）会使整份结果进入 `failed`。
- 失败任务只保留错误消息，不保留可供用户审阅的原始/归一化候选结果。

## Direct implication

当前流程把两个不同动作合并了：

1. 接收模型结果；
2. 将结果提升为可确认的 Director draft。

这会把“模型已经完成分析”和“本地结果仍需修复”错误地显示为同一个失败状态。

## Design decision

Director analysis 使用三层结果状态：

| 层级 | 状态 | 行为 |
| --- | --- | --- |
| 接收层 | `received` | 上游有非空返回且可解析为 JSON；结果必须持久化，即使后续校验未通过 |
| 修复层 | `normalized` / `needs_review` | 服务端完成安全归一化；不可绑定的引用、非标准标签和缺失可编辑文本进入 warnings/unresolved refs |
| 确认层 | `confirmable` / `blocked` | 只有无法安全表达结构的数据才阻止确认；用户可在编辑器修复 warnings 后继续 |

## Hard failures

以下情况仍可使任务失败，但必须保存 `failure_stage` 和原始响应摘要：

- 上游没有返回内容；
- 返回内容不是合法 JSON，且无法从 Markdown 包裹中恢复；
- 顶层不是对象；
- 缺少无法生成的稳定主键（例如 phase/event/thread ID）；
- 结构关系无法安全表达且没有可降级字段。

## Recoverable findings

以下情况不得丢弃整个结果：

- 非标准 `evidence_status`；归一为 `interpretation` 并保留原标签；
- `status`/`arc_id` 等可确定别名；
- 契约外元数据字段；投影掉并记录 warning；
- 未知角色/道具引用；移入 `unresolved_*_refs`；
- 缺失导演描述；保留空值，交给编辑视图补充。

## Persistence contract

每个 Director job 的结果至少记录：

- `raw_response_received: true/false`；
- `parse_status`；
- `normalization_status`；
- `warnings[]`；
- `unresolved_refs[]`；
- `profile`（若已能构造）；
- `failure_stage`（仅失败时）；
- `upstream_request_id`（若 adapter 可取得）。

### Source audit artifact

初次 Director 分析还要按 owner/project 保存 `source_audit`：

- `source_mode`、`source_char_count`、`chunk_count`、`chunk_ranges`；
- map 阶段的 `mapped_notes`；
- 最终送入 synthesis 的 `digest` 和 SHA-256（仅 `map_reduce`）；
- 模型返回的 bounded `raw_response` 和 SHA-256；
- 失败时仍保存 `failure_stage` 和 `failure_detail`。

原始剧本、API key、Authorization header 和完整 prompt 不写普通日志。该 artifact
只通过 owner-scoped extraction job 查询，并按现有 job retention 清理。

前端应把 `received/needs_review` 显示为“已收到，需处理”，而不是“分析失败”。
只有 `failed` 才显示失败并提供重试。

## Confirm boundary

接收和归一化不会自动确认 Director revision，也不会让未确认结果进入拍摄计划。用户仍需在编辑视图处理 warnings 并保存/确认。该边界保留用户决定权，同时避免因可修复模型差异丢失长时间分析结果。

## Semantic reference binding

模型不得被视为项目实体 ID 的权威来源。模型负责返回人物、道具和场景的
名称、别名、时期描述或其他语义引用；服务端根据当前项目/系列实体库绑定
canonical ID。绑定结果分为：

- `resolved_*_ids`：服务端确认存在的实体 ID，进入 canonical story map；
- `unresolved_*_refs`：无法唯一匹配的模型引用，保留原文并显示给用户；
- `ambiguous_*_refs`：多个实体候选，保留候选列表，等待用户选择。

模型返回的 UUID、`person_01`、`arc_01` 等字符串不得直接写入 canonical
ID 字段，除非它们已通过服务端实体索引验证。该规则适用于 Director
事件、关系弧、剧情线和后续 shooting plan 的角色/道具/场景引用。

## Compression and drift audit (2026-10-01)

### Observed

- The affected episode has 5,291 source characters and is split into one
  Director source chunk. Its entity context contains 24 character variants,
  20 scenes, and 16 props.
- The final Director synthesis reads the mapped digest, not the 5,291 source
  characters. The single chunk note keeps at most 360 summary characters,
  two facts and two open threads; head and tail anchors each keep 240 source
  characters. The whole digest has a 3,000 character cap.
- Failed job rows retain only a truncated validation error. The raw model
  response and mapped note are not persisted, so the failed runs cannot be
  audited for semantic drift after the fact.

### Direct implication

This is a one-chunk compression risk, not evidence of cross-chunk ordering
drift. A 5,291 character source may lose middle-scene distinctions before
final synthesis. An unknown canonical ID separately indicates an entity
binding problem; it does not by itself prove that the model misunderstood a
character or plot event.

### Next verification slice

1. Persist the received response and mapped note as owner-scoped review
   artifacts with bounded retention, without writing secrets to logs.
2. Compare source events, entity names, mapped note and final story map for
   the same job. Classify mismatches as source omission, entity alias mismatch,
   model invention, or binding failure.
3. For one-chunk sources near this size, compare direct-source synthesis with
   digest synthesis under the same model and prompt contract. Measure event
   coverage and unsupported claims before changing the 4,000 character
   threshold or digest budget.
4. Treat the 4,000-character boundary as an experiment variable, not a
   correctness rule. A threshold change requires the A/B evidence above.

## Verification

- 模拟含未知角色引用和非标准状态的完整返回，job 最终为 `needs_review` 或 `completed + warnings`，并可读取 profile；
- 模拟非法 JSON，job 为 `failed` 且保存 failure stage；
- 前端轮询不把 `needs_review` 当作运行中或失败；
- 既有确认、revision 和拍摄计划 gate 行为不变。
