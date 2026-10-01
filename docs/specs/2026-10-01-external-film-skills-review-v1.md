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

AI 生成的故事、视觉或镜头修改必须先作为候选 revision 展示，并提供三种明确动作：

1. **接受 AI 修改**：将候选内容保存为新的用户采用 revision，保留原版本和 diff；
2. **继续修改**：以 AI 候选为起点进入用户草稿，用户可以增删改，保存后形成新的 revision；
3. **删除 / 拒绝**：移除该候选修改，恢复继续使用此前采用的版本，原文和历史 revision 不受影响。

这三种动作都要记录：

```text
source_revision
ai_candidate_revision
user_action: accepted / edited / deleted
result_revision
diff_summary
timestamp
```

“接受”不是不可逆锁定；用户之后仍可继续修改或回退到历史版本。“删除”只删除候选修改，不删除剧本原文、Series 理解或已经确认的历史版本。

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
