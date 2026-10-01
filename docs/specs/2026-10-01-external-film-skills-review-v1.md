# 外部 Film / Drama Skills 对 iframe 工作流的复核 v1

## 阅读范围

本次读取了四个公开 GitHub 仓库的公开文档：

- [zenstory-ai/drama-skills](https://github.com/zenstory-ai/drama-skills)：README、DESIGN；
- [kangarooking/director-skills](https://github.com/kangarooking/director-skills)：README；
- [62656456/ai-film-skills](https://github.com/62656456/ai-film-skills)：README、SKILL_CATALOG；
- [Coconah/AI-Short-Drama-Agent-Skill](https://github.com/Coconah/AI-Short-Drama-Agent-Skill)：README、SKILL.md。

以下结论只针对公开文档中可以直接核对的内容。没有把仓库的宣传描述当成运行效果证明。

## 共同的可借鉴方向

### 1. 阶段化工作流

几个仓库都把创作拆成多个阶段，而不是一次请求完成全部工作。可抽象为：

```text
原著 / 灵感
→ 故事开发
→ 分集或单集剧本
→ 人物 / 场景 / 道具资产
→ 分镜 / 摄影
→ 图片与视频提示词
→ 用户确认后生产
→ 剪辑与审查
```

这与 iframe 当前的 Series → Episode → Director → Shooting Plan → Storyboard 链路一致。

### 2. 文件或 artifact 是阶段交接面

Drama Skills 明确提出每集维护独立的 `剧本.md`、`视觉设定.md`、`分镜.md`、`图片提示词.md`、`视频提示词.md`，并通过引用和脚本检查跨镜连续性。

iframe 不需要复制成第二套 Markdown 权威源，但应保持同样的交接语义：

- 每个阶段有独立 artifact；
- artifact 有 revision、来源和采用状态；
- UI 展示和模型输入必须来自同一 revision；
- 检查结果显示具体原因和来源，而不是只显示“校验失败”。

### 3. 先预览和确认，再产生外部成本

Drama Skills 和短剧 Skill 都强调提示词、参数、参考素材先落地或预览，用户明确确认后才调用生成接口。

iframe 应继续保持：

- Director 理解先 draft，再 confirm；
- Shooting Plan 先保存和审阅，再生成 Storyboard 或视频；
- provider task ID、参数和参考素材顺序在提交前可见；
- 任务中断后优先 collect，不重复付费提交。

### 4. 分镜必须记录起止状态和连续性

公开样例把分镜写成“起点 → 终点 → 运镜作用”，视频提示词只负责执行这一段动作。跨镜锁定的人物外形、服装、道具状态和参考图用途都要能追溯。

iframe 应将这些内容结构化为：

- `state_in` / `state_out`；
- character / scene / prop canonical IDs；
- continuity locks；
- source chunk refs；
- previous batch handoff；
- `@原始文件名` 和参考素材 URL 的显式映射。

## 各仓库的具体启发

### zenstory Drama Skills

公开 README 的核心设计是“十一个技能覆盖从原著到成片”，并强调：

- 五份 Markdown 作为可读创作事实；
- 连续性锁可以原样复制进提示词；
- 分镜、视频提示词和生产分开；
- 生产前明确确认；
- 检查脚本给出具体引用缺失或时长不一致的原因。

iframe 应吸收“可读交接 + 确认边界 + 具体校验原因”，但保留结构化数据库、owner scope、revision 和 API key 身份体系，不把 Markdown 当作唯一持久化存储。

### kangarooking Director Skills

公开仓库目录显示其按导演职责拆分动作/打斗提示词、电影资产提示词等专项技能。可借鉴“按视觉任务拆分知识”，例如：

- 动作与打斗；
- 人物、场景、道具资产；
- 摄影、光线、构图；
- 不同类型的视觉语言。

这些应该进入 iframe 的经验提示和知识库层，不应变成自动替用户决定的强制流程。

### 62656456 AI Film Skills

公开 README / catalog 显示其把 `director-agent`、`ai-storyboard-director`、`character-asset`、`scene-asset`、`prop-asset`、类型视觉顾问、生产和审查拆成独立模块，并区分常规和实验模块。

可借鉴：

- 能力目录和职责边界；
- 视觉类型提示单独维护；
- 白模预演与完整生产分开；
- 文字检查、实际加载、真实任务和用户接受分别记录；
- 对实验能力明确标注范围，不把历史演示升级为生产保证。

iframe 应把这些变成能力提示和 review finding，而不是在 Director 阶段直接完成所有作品。

### Coconah AI Short Drama Agent Skill

公开 `SKILL.md` 将流程写成五步：项目启动、全局大纲、分集规划、单集拍摄剧本、剧本医生精修，并强调同一上下文连续推进。

iframe 需要采用其“阶段顺序”和“每阶段触发条件”，但不能照搬“替代人类完成创作”的目标。iframe 的边界是：

- 提供阶段化草稿；
- 追踪版本和来源；
- 给出剧情钩子、节拍、视觉表现和连续性提示；
- 用户决定是否接受；
- 不直接把补充内容写成剧本原文。

## 不能直接照搬的内容

### 1. 不把经验套路变成硬规则

例如“10 秒内强冲突”“必须核爆级反转”“每集必须强制黑屏钩子”等，属于特定短剧平台或写作风格的建议，不是所有电影、爱情片或纪录性内容的事实约束。

iframe 可以提示：

```text
可检查：本集结尾是否需要更强的悬念或情绪余波？
依据：短剧节奏知识库
状态：suggestion
```

不能自动改写成：

```text
本集必须增加反转。
```

### 2. 不把模型连续会话当作长期记忆

公开文档描述了“同一上下文”或工作目录交接，但不能据此证明 provider conversation/thread 可恢复。iframe 仍应依靠 source revision、Series Context、Episode Context、Director revision 和 handoff。

### 3. 不把视觉知识库当作剧本事实

类型惯例、镜头语言、构图、灯光、钩子和情绪曲线属于经验提示。它们必须与原文事实、导演解释、用户决定分层保存。

### 4. 不直接复制外部仓库代码或文案

本次只吸收公开架构和交互原则，不复制具体提示词、示例文本、未核实的媒体结果或受许可限制的代码。

## iframe 的采用清单

### 立即采用

- 阶段化 artifact 和明确交接；
- Series / Episode 分层；
- 分镜 `state_in/state_out`；
- continuity lock 和参考素材用途；
- 生产前预览确认；
- 具体可解释的校验错误；
- 外部能力按普通、实验、未验证分级；
- 经验提示使用 suggestion / accepted / edited / dismissed 状态。

### 用户对 AI 修改的决定

AI 返回的故事、视觉或镜头结果直接进入当前功能域的**可编辑草稿**，不再先展示要求接受的候选卡。用户可以在结果上直接修改、删除内容并保存；保存产生草稿 revision，确认后才成为下游默认采用版本。重新分析也只替换当前未保存草稿，必须保留已确认版本和历史 revision。

用户可通过版本管理回看此前版本及 diff。界面需要明确“未保存草稿”和“已确认版本”的状态，减少反复确认步骤。原文和其他功能域的版本不随本域草稿操作改变。

### 继续保持

- API key 身份和 owner-scoped workspace；
- 原文只读和 source range；
- Director draft / confirmed revision；
- Shooting Plan 独立版本；
- 上游已返回时保留 raw response；
- unresolved entity 不阻断整份计划；
- 结构化数据是权威，Markdown 是可读投影。

### 暂不采用

- provider conversation session 作为记忆；
- GraphRAG 或向量库作为第一阶段硬依赖；
- 强制三幕式、固定钩子或固定每集镜头数量；
- 经验规则自动改写剧本；
- 让 Agent 替用户完成全部创作决定。

## 结论

外部 Skills 的共同价值是把创作工作拆成可读、可确认、可复核的阶段。iframe 应吸收这种工作流设计，但产品角色仍是：

> 帮用户整理、追踪、比较、提示和恢复创作过程，把重复劳动自动化；把经验知识作为可解释建议；把最终故事、视觉和镜头决定留给用户。

---

## 本轮增补：Toonflow、waoowaoo、Jellyfish、ViMax

### 证据范围与强度

以下判断来自四个公开仓库当前检出的 README、公开设计文档和核心源代码。它们证明了代码中存在相应的数据结构或流程；不能单凭仓库存在这些字段就证明其线上部署、模型效果或生产规模已经验证。

### 1. HBAI-Ltd/Toonflow-app

**代码事实**

- README 将产品定位为无限画布上的剧本、资产、图像和视频工作流，并列出资产画布、3D 导演台、多参考视频生成和开放 Agent。
- `packages/teams/storyboardTeam` 将导演、编剧、审阅者拆成团队成员；`director.md` 要求区分原始事实、合理补充和未确认信息，并把成员结果视为待核验材料。
- `packages/teams/storyboardTeam/skills/storyboard/SKILL.md` 要求按剧情节拍组织镜头，记录主体、动作、景别、声音和时长，并明确文字分镜不等于媒体产物。
- `packages/skills/workflow/SKILL.md` 把剧本、资产、Seedance 提示词和画布执行分开，并对 Seedance 阶段设置硬隔离；`sourceAndScript.md` 也要求保留原稿、采用范围和版本边界。
- 服务端存在 `mentionFiles`、工作区文件 API、Agent skill 加载和 personalization 文档；这说明其引用对象和技能资料是工作区资源，而不是单次 prompt 中的临时字符串。

**直接 implication**

Toonflow 的强项是“创作知识与执行工具分层”：导演可以先形成可审阅的文字方案，再进入画布和真实媒体执行。它对 iframe 最有价值的不是无限画布本身，而是 `source → draft → execution` 的边界、技能按任务读取以及事实/补充/待确认三分法。

**尚未证明**

公开仓库不能证明其长剧本跨集一致性已经由图谱或 provider session 解决；也不能证明硬隔离规则在所有模型调用路径上都生效。

**对 iframe 的采用**

- 保留原文只读，把 Series Director、Episode Director、Director Intent 和 Shooting Plan 作为不同 artifact。
- 将剧情钩子、视觉表现、镜头语言做成 `suggestion` 知识层；不把它们升级为剧本事实或强制 gate。
- 在生成提示词前显示采用的 Director revision、参考素材名称和映射；生成结果直接进入可编辑草稿。

### 2. waooAI/waoowaoo

**代码事实**

- Prisma schema 存在 `ProjectAssistantThread`、`ProjectAgentTurn`、`ProjectAgentProviderAttempt`、`WorkspaceResource`、`WorkspaceResourceVersion`、`WorkspaceResourceLineage` 和 `TaskExecutionCheckpoint`。
- 项目工作区把对话、素材和生成结果放在同一项目内；README 明确支持连续 Assistant 对话、参考图、结果再加工和版本化资源。
- schema 对 provider attempt、任务父子关系、任务事件、执行检查点、资源版本和输入/输出 lineage 都有独立记录。
- `project-production-context.ts` 将模型能力、参考素材上限和版本化生产上下文作为显式对象；`workflow-concurrency.ts` 对分析、图片、视频工作流分别设置并发上限。

**直接 implication**

waoowaoo 提供的是 iframe 当前缺失的“运行时证据层”：一次用户动作、一次 provider 尝试、一个任务、一个检查点、一个资源版本和输入输出 lineage 应该可以分别查询。它不是导演理解算法，但能解决此前出现的“上游已返回、前端仍 running”“重试重复提交”“结果没有绑定到哪一版 Director draft”等问题。

**尚未证明**

这些模型和检查点字段证明持久化设计存在，不证明每个异步 provider 都已经正确回写终态，也不证明 UI 已经完整展示所有 lineage。

**对 iframe 的采用**

优先采用最小运行记录：`generation_attempt`、`provider_attempt`、`task_checkpoint`、`input_revision`、`output_revision`、`raw_response`、`terminal_reason`。轮询发现上游终态时必须立即 collect，不能继续使用本地固定 running 超时覆盖事实。

### 3. Forget-C/Jellyfish

**代码事实**

- README 将生产单位定义为 Project → Chapter production workspace，并列出脚本输入、智能浓缩、分镜提取、分镜编辑、视频生成和预览。
- `ScriptDividerAgent` 输入完整剧本文本，输出章节内镜头列表，包含 `index`、行范围、镜头标题、原文摘录和时段；代码对模型返回的列表、包装对象和标题别名做规范化。
- `script_processing.py` 和 `script_processing_tasks.py` 把 divide、extract、consistency、optimization 等处理变成可轮询的异步任务，并通过任务关系和 Celery worker 执行长任务。
- `ShotExtractedCandidate` 以 `character/scene/prop/costume` 分类保存候选实体，状态初始为 `pending`；镜头角色链接、场景和道具外键允许为空或通过用户绑定完成。
- `ConsistencyCheckerAgent` 专门检查角色身份/行为混淆，而不是把所有模型不确定性都当作阻断错误。

**直接 implication**

Jellyfish 对 iframe 的重要启发是“提取结果和采用结果分开”：模型先产生镜头级候选，候选可以 pending，随后用户把候选绑定到项目角色、场景或道具。这样模型返回未知实体不会导致整份拍摄计划失败，也不会把未来资产 ID 伪造回填。

**尚未证明**

Jellyfish 的 ScriptDivider 是“完整剧本 → 章节内镜头”单阶段提示，并不等同于 Series Director 的全剧理解；其 README 仍把很多高级能力标记为开发中。

**对 iframe 的采用**

- 拍摄计划中的 `character_id/scene_id/prop_id` 应允许 `null`，同时保留 `unresolved_label` 和来源文本。
- 将“模型候选”“用户绑定”“已确认资产引用”分开显示；未知项给出可修订提示，不拒绝整份计划。
- 每个 Episode 记录本集出场人物、出场场景和时间状态；全剧关系和背景继续放在 Series Director。

### 4. HKUDS/ViMax

**代码事实**

- `prompts/workflow.md` 明确定义 `idea2video`、`script2video`、`novel2video` 三种入口及不同 DAG；`script2video` 从 characters → storyboard → shot decomposition → camera tree → frame prompts → keyframes → clips，`novel2video` 先压缩文本，再提取事件、检索相关片段、提取场景和全局人物。
- `Novel2MoviePipeline.plan_text_artifacts()` 先保存原文并分块，逐块压缩后聚合；随后抽取事件、使用向量检索和 rerank 找相关原文片段，再提取场景，并将每一阶段写入工作目录。
- `Script2VideoPipeline.plan_text_artifacts()` 将角色、storyboard、shot descriptions、camera tree 作为可恢复的文字产物，渲染前停止，允许 Agent Loop 先审阅。
- `.working_dir/<session>/` 是 artifact authority；`.vimax/sessions.json` 只是 session 索引，`.vimax/memory.md` 仅保存用户偏好。`SessionIndex` 使用锁、原子替换和 compaction snapshot，避免并发写丢失。
- `STALE_KEYS` 对下游产物做失效标记；session 记录 stage、summary、recent turns、compacted summary 和 compaction snapshots。

**直接 implication**

ViMax 最接近 iframe 当前要解决的长文本问题：原文、压缩摘要、事件、相关原文片段、场景和镜头不是一次 prompt，而是带来源的阶段产物。它还明确把“上下文记忆”拆成 artifact authority、session index 和用户偏好三层，避免把聊天历史误当作唯一事实源。

**尚未证明**

其 `novel2movie` 文件中仍有未实现或实验性路径，且公开代码不能证明检索阈值、压缩质量和跨集角色一致性在真实长剧上达到稳定效果。向量检索也不能替代导演确认。

**对 iframe 的采用**

- 为 Series 与 Episode 建立独立的 `context_bundle`：原文范围、结构化事实、压缩摘要、关系/状态变更、未决问题和用户采用记录。
- Director 分析只提交当前阶段需要的 bundle 与相关 chunk，不再每次携带整部剧本和所有历史输出。
- 对下游产物维护 stale/affected 标记：修改 Series 背景只使受影响的 Episode Director/Intent/Plan 变为“需检查”，不抹掉用户已保存的草稿。
- 把摘要和检索片段当作可追溯输入，UI 可展开查看来源 chunk；摘要错误应能回溯到原文，而不是显示一个无法解释的 validation error。

## 四个仓库对 iframe 的综合映射

```text
Series source / 投稿资料
  → Series context bundle（ViMax 分层 artifact）
  → Series Director draft / confirmed revision
  → Episode context bundle（Jellyfish 章节范围 + 出场实体）
  → Episode Director draft / Director Intent
  → scene → beat → shot（Toonflow 的文字交接边界）
  → generation attempt / provider attempt / checkpoint（waoowaoo 运行证据）
```

这四层分别解决不同问题，不能合并成一个“导演分析 JSON”：

1. **理解层**：原文事实、来源 chunk、摘要和不确定性；
2. **创作层**：导演补充、视觉建议、剧情钩子和用户编辑；
3. **执行层**：场景、节拍、镜头、参考素材和参数；
4. **运行层**：任务尝试、上游 ID、轮询、检查点、原始返回和结果 lineage。

## 当前 iframe 优先级

### P0：先修运行事实

- 上游已返回时收敛本地任务状态并保存 raw response；
- 每次重试建立新的 attempt，引用同一 input revision，不覆盖旧 attempt；
- 任务失败只标记具体阶段和原因，不把模型结构化问题伪装成“没有提交”。

### P1：长文本和分层上下文

- Series 只处理全剧背景、时代、地点、全局人物关系、主线/支线和风格基线；
- Episode 只处理本集事件、人物、场景和时间状态；
- 每个 chunk 生成摘要和来源范围，并在全局 bundle 中登记角色/场景别名与状态变化；
- 重新分析默认读取受影响 chunk，只有用户明确选择“全剧重算”才全量提交。

### P2：开放的候选和编辑

- AI 返回直接进入可编辑草稿；
- 未知角色、场景、道具保留为 unresolved candidate，不阻断保存；
- 事件标题、戏剧作用、剧情线和场景分析都是用户可写的 Director draft 字段；
- Director draft 保存和 Director confirm 合并为清晰的两个动作：保存只是产生 revision，确认才改变下游默认输入。

### P3：导演知识提示

- 增加可关闭的剧情钩子、节拍、视觉表现、类型风格和镜头语言提示；
- 每条提示标记 `suggestion / accepted / edited / dismissed`；
- 不把短剧经验、三幕式或固定镜头数量写成强 gate；
- 不在 Director 阶段直接新增剧本对白或修改原文。

## 仍然不采用

- 不把 provider chat session 当作 Series/ Episode 的长期记忆；
- 不把向量库或知识图谱作为第一版保存成功的前置条件；
- 不复制外部项目的固定节奏、固定镜头数量、固定钩子或“模型必须返回完整实体 ID”的强约束；
- 不因为模型输出未知字段、别名或缺失资产就拒绝用户已经同意保存的导演分析或拍摄计划。
