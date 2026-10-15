# 剧本、剧集、分镜与 AI 优化上下文核对

日期：2026-10-15。代码基线：GitHub main `ae16fa0e`；另核对 PR #121 的 `299aa357`。本文是代码与现有契约审计，不是生产验收或新实现完成声明。

## Observed

### 已有规范及其适用边界

| 范围 | 规范 | 约束 |
| --- | --- | --- |
| 项目与系列 | [项目/系列上下文统一](../specs/2026-10-08-project-and-series-context-unification-v1.md) | 共享生产组件；独立项目与系列分集采用不同上下文投影，不复制两套生产实现 |
| 剧集资料 | [剧集结构化上下文](../specs/2026-09-30-series-episode-structured-context-v1.md) | 持久化业务事实、人工采用的产物；按任务组装有限上下文，不把聊天记录或整个项目当事实 |
| 导演与风格 | [系列风格与导演继承](../specs/2026-10-08-series-style-director-inheritance-v1.md) | 系列风格默认继承；本集显式覆盖；本集实体与全剧只读背景分离，共享素材不等于本集出场角色 |
| 资产工作域 | [工作域索引](../specs/2026-09-24-asset-material-workspace-index-v1.md)、[作用域与复制](../specs/2026-10-06-asset-scope-cover-validity-uniqueness-v1.md)、[身份规则](../specs/2026-10-10-script-plan-asset-material-identity-v1.md) | 候选池与项目成员分离；全局资产须显式导入/绑定；允许所属系列继承，角色工作台可浏览全局候选 |
| 场景与镜头 | [连续性投影](../specs/2026-10-13-scene-submission-continuity-projection-v1.md) | 地点、时段、光线基线按适用范围投影；文字连续性说明不等于结构化状态交接 |
| 优化与提交 | [生命周期实施计划](../specs/2026-10-14-context-lifecycle-optimization-plan-v1.md) | 上下文在 LLM 前进入；采用后的完整正文保持一致；参考图、权限和模型参数仍独立校验；阶段 3–6 尚未完成 |

另读取先前诊断工作树中的三份研究记录：`2026-10-14-script-director-shot-context-lifecycle-summary.md`、`2026-10-14-llm-prompt-optimization-contract-summary.md`、`2026-10-14-shot-style-lighting-continuity-summary.md`。这些文件本次不在 main 的 `docs/research/` 中，不能依赖 main 中已有链接来保证读者可访问。

其中 10 月 15 日镜头交互决定明确：**结构化风格、光线是设定源；润色读取当前正文与字段，返回可编辑完整正文；随后修改任一字段应更新可见提交内容，无须强制再次润色。** 这是对当前用户要求的记录；不表示主线已完整实现。

### 实际代码路径（code fact）

| 消费阶段 | 当前路径与证据 | 状态/缺口 |
| --- | --- | --- |
| 剧本来源与事实 | `pipeline.py::_fact_ledger_execution_context` 检查确认状态及来源修订，失效时不输出事实；按实体/来源范围过滤，限制 40 项/7200 字符 | 有版本化事实投影；不是全流程统一快照 |
| 全剧导演 | `preview_series_director_profile` 将系列 preamble 与各集 `original_text` 拼接；实体从各集源实体收集，而非共享库 | 没有在此调用建立完整逐集 ID/revision/hash 目录；不能从文本顺序推定逐集来源可追溯 |
| 本集导演 | `director_analysis_context` 使用 `director_source_assets(script)`，只取本集数组；系列资料与已确认全剧导演放在独立键中作为背景 | 已区分本集实体与系列背景；背景存在不证明模型一定正确遵守边界 |
| 风格继承 | `effective_art_direction`、`effective_director_profile` 分开解析；已有测试覆盖本集导演确认后继续读取系列风格 | 不应照搬早期规范中“当前故障”段落当作今日代码现状；旧数据来源仍不能反推 |
| 拍摄计划与分镜来源 | `generation_lineage`、`validate_storyboard_lineage` 和计划修订/投影关联来源；长段分镜处理按来源范围，并带前 3 镜作为局部延续输入 | 有局部 lineage；不能等同统一的 L0–L5 输入快照或人物/道具状态机 |
| 分镜分析实体 | `storyboard_analysis_context` 调用 `resolve_episode_assets`；后者明确合并 Episode > Series > Global，返回角色、场景、道具的整个全局底层池 | **未收口：未导入全局候选仍进入分镜分析上下文**。这与本集导演已采用的边界不同 |
| 镜头细化 | `_episode_shot_context_prompt` 优先当前 frame 投影，否则按 `shot_id` 定位；序列化后直接 `[:6000]` 截断 | 有精确镜头查找；超长内容可能成为不完整 JSON，且没有统一字段预算/来源快照 |
| AI 视频/R2V 润色 | `api.py::_get_director_prompt_context` 按 script/frame 查找，选择 scene/shot 字段；光线基线须匹配地点与时段 ID；逐字段裁剪后序列化。两个 polish handler 在 LLM 前加入此投影 | 没有把整份剧集导演 JSON 直接塞入此入口；当前函数不投影工作台 `shot_overrides`，计划光影与用户显式覆盖仍可能同时进入不同输入部分 |
| 润色后字段编辑 | `StoryboardR2V::handleUpdateField` 修改 style/lighting 字段；`buildGenerationPrompt` 在 `promptIsOptimized` 时直接返回正文 | **未收口：已润色正文不因字段变化自动更新**。直接去掉布尔判断会重新追加约束，也不满足可见正文契约 |
| 未润色正文 | `buildAssembledPrompt` 回退全局正向风格；导演摘要还输出场景 atmosphere、continuity、计划 lighting | 显式光线覆盖未抑制计划光影；交叉场景摘要可能跨入当前镜头。与生产兼容树的有界摘要/覆盖优先实现有差异 |
| 首帧生成 | `prompt_is_complete` 控制后端及生成器是否继续追加；Composer/FrameEditor 预览令牌绑定正文和上下文，并检查入队/执行前变化 | 这两个入口及首帧完整正文已有测试；标记不绕过引用和权限校验，不表示所有历史调用已迁移 |
| 工作域 UI 与 R2V 提交 | PR #121 引入 `scope=project`，镜头抽屉/芯片及提交刷新使用项目索引；角色工作台保留全局候选入口 | 只修复这些消费面；**未修改 `resolve_episode_assets`，不能宣称分镜分析上下文已同步修复** |

生产对比边界：本次只比较本地生产兼容树相关文件与 main，没有重新读取 malysis 运行容器或捕获真实上游请求。不能据此宣称线上当前回滚、或本地与线上今天完全一致。

### 验证记录

- 在 PR #121 集成 main #120 后执行 8 个后端模块：168 passed、1 skipped、1 failed。包括导演、计划、预览、润色、Context IR、共享池和索引测试。
- 唯一失败为 `test_series_model_update_preserves_episode_override`：系列设置更新后，继承集仍保留旧 `t2i_model`。在干净 main `ae16fa0e` 单独运行同一测试也失败，已确认不是 PR #121 新引入；这是额外未收口项，不应混进资产索引修复。
- 此共享池模块位于 `src/apps/comic_gen/`，而 pytest 默认 `testpaths=["tests"]`。因此默认 CI 后端通过不能证明该模块全部通过。
- 前端 `buildAssembledPrompt.test.tsx` 与 `PolishPanel.test.tsx`：12 passed。这些测试包含采用正文不追加的现有契约；没有验证润色后改风格会同步正文，不能据通过结果宣称该缺口已解决。
- 没有调用付费模型，没有进行浏览器或生产写操作。

## Direct implication

规范确实存在，且部分路径已经实现。但资产候选可见性、叙事实体范围、镜头参考选择是三个不同问题；修复抽屉不会自动修复分镜分析。当前必须按消费入口收口，不能全局替换解析器默认行为，因为导入候选和共享库编辑仍需要宽索引。

AI 润色也需要分开看“读取什么”和“采用后提交什么”。当前完整正文不追加的保障应保留；字段变化应先更新可见完整正文，再提交这个版本，不能通过隐藏尾缀或强制再次润色掩盖不一致。

## Not yet proven

- 模型是否会把多余全局角色写入具体镜头，或风格冲突是否造成某次生成偏景；代码只能证明这些输入可能到达模型，不能证明单次结果因果。
- 所有 provider 的实际请求正文、引用顺序和最终可访问 URL 是否与界面一致。
- 全部历史项目的绑定身份、系列继承与已优化正文是否已迁移；旧记录缺少来源映射时不可自动猜测。
- 结构化跨镜头 `state_out → state_in`、统一优化来源状态及统一版本化快照已经生效。实施计划明确仍有待开始阶段。

## Hypotheses

宽资产池可能造成叙事实体混淆；全局风格回退和计划光影重复可能影响当前镜头地点/照明。这些仅为待验证假设，需要捕获该镜头实际 LLM/provider 请求与人工输出审查。

## What would verify it

按独立 PR 推进，保留管理员审核合并边界：

1. **分镜分析工作域**：新增显式 project resolver 语义；先用失败测试证明分镜分析收到未导入的全局角色，再限制分析、细化等明确消费面。逐一盘点现有 resolver 调用，保留候选导入功能及所属系列继承；测试同名不同 ID、跨集和本地覆盖。
2. **当前镜头风格/光线闭环**：先复现“采用润色→修改光线→首帧/视频仍提交旧正文”；把当前覆盖投影进润色输入，明确覆盖替代计划镜头光影；编辑后更新可见正文并保存同一版本，分别捕获 T2I/I2V/R2V 输入，保持 H3 正文结构。历史模型改写的同义内容不可声称能靠字符串替换完全消除。
3. **有界来源投影**：替换截断 JSON 的细化路径，建立字段预算及来源 ID/revision/hash；覆盖超长、多集、同名场景和来源变化失效测试，再逐步完成生命周期计划阶段 3/5。
4. **独立设置继承缺口**：为已复现的系列模型变更继承问题单独修复及加入默认 CI；保持用户显式本集覆盖。
5. **运行与视觉验收**：部署须单独执行版本核对；使用获准的诊断记录比较可见正文与上游 payload，再进行跨场景/时段的人工画面审查。代码测试与视觉结论分别记录。
