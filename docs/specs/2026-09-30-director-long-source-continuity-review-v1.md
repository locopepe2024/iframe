# Director 长文本分片与连续性审计 v1

## Observed

- Director 理解长文当前采用 map/reduce：每个 source chunk 先单独摘要，再提交一次有界 digest 做最终理解。
- 摘要请求原先按 chunk 串行执行；因此上游等待时间随 chunk 数量线性增加。
- 拍摄计划按 source chunk 顺序生成并支持批次恢复，但每段重复发送 bounded Director execution payload，跨段只传递上一场的少量字段。
- 场景合并的语义依据主要是模型返回的 `continues_previous_scene`，source chunk 边界本身不是场景边界。

## Direct implication

- 长文性能不能只通过提高单次 timeout 解决。请求数量、重复输入和可恢复边界必须被显式控制。
- map 阶段的独立 chunk 可以并发执行；最终 reduce 仍必须在所有 map 结果可用后执行。
- 拍摄计划必须把跨段连续性作为显式 handoff：上一段的 scene/beat 状态、人物与道具状态、时空/轴线约束和 unresolved refs 传给下一段。handoff 是模型工作记忆，不是新的剧本事实。
- 缓存批次必须按 source_ref、输入 lineage 和契约版本命中；旧批次不能静默混入新剧本或新 Director revision。

## Not yet proven

- 并发 map 会降低端到端时间，但实际收益取决于上游并发限制和每次响应时延。
- handoff 能降低跨段重复场景或人物状态漂移，但不能证明模型理解一定正确；结果仍须由用户审阅。
- 场景同义词自动合并存在误合并风险，因此只有明确连续标记且位于新段首场时才合并。

## Contract

### Per-request input budget

Director provider calls use a character budget of approximately 5,000–7,000
characters per submission. This is a deterministic source/prompt budget, not a
provider tokenizer promise. The source is split at sentence or paragraph
boundaries with a target of 5,200 and a hard limit of 6,500 characters. Even a
short source is mapped to a bounded source digest before final synthesis, so
the final request does not repeat the raw script together with entities,
presets and the output schema.

The final synthesis receives the bounded digest and compact context only. It
must not receive the complete raw source plus all stage Markdown files. Exact
provider input/output token counts remain provider billing data and must be
recorded from the upstream response when available.

### Director map note

每个 chunk 保留服务端拥有的 `source_ref` 与 `[char_start, char_end)`。模型只能返回摘要、continuity_in/out、facts、open_threads。服务端不得采用模型伪造的来源区间。

### Continuity handoff

拍摄计划每段输入包含：

- 上一段最后场景的 `scene_ref`、heading、location、time_anchor；
- 上一段 `continuity_out` 与最后 beat；
- 已产生的 unresolved entity refs；
- 当前 Director execution payload 的 revision/hash。

只有新段第一场明确 `continues_previous_scene=true` 时才合并到上一场；同地点或相似标题不构成合并依据。

### Recovery

- 已完成 chunk 批次按 source_ref 和 generation fingerprint 复用。
- 失败重试只重新请求缺失或失效 chunk；已保存批次不得重复请求。
- 任一 lineage、源文本、Director revision/hash、模型或契约版本变化，旧批次全部失效。

## Implementation slice

1. map 摘要使用有界线程池并发，保持结果按 source 顺序写入 digest；任一失败仍返回可定位的 chunk 错误。
2. 拍摄计划沿用顺序生成，但把连续性 handoff 扩展为结构化字段，并在批次恢复时从已合并结果重建 handoff。
3. 增加测试：并发 map 保持顺序、失败可定位、handoff 传递、仅首场连续合并、旧批次不跨 source_ref 复用。
4. 保留较长 provider timeout 作为单请求上限，但不把它当作长文性能方案。

## Verification

```bash
pytest -q tests/test_director_profile.py tests/test_director_shooting_plan.py
python3 -m compileall -q src/apps/comic_gen/llm.py src/apps/comic_gen/pipeline.py
git diff --check
```
