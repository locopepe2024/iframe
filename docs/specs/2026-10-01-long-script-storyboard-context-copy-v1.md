# 长文剧本分析与分镜生成：阶段交接文案 v1

## 产品总说明

系统不会依赖模型记住上一轮对话。每个阶段都从已保存的原文、结构化结果、用户确认版本和来源范围重新组装上下文。

摘要用于检索和定位，原文用于核对证据。摘要不能替代原文，也不能因为摘要没有提到某件事，就推断原文没有该内容。

```text
Series 全局资料
  ↓
Episode 场景原文
  ↓
结构化解析与分层记忆
  ↓
Series Director Understanding
  ↓ 用户保存并确认
Episode Director Understanding
  ↓ 用户保存并确认
Director Intent / Continuity
  ↓ 用户采用
Shooting Plan
  ↓ 分片交接
Storyboard / Assets / Video
```

## 阶段一：Series 全局资料

### 目的

建立全剧范围的背景和故事边界，不生成某一集已经发生的具体事件。

### 输入

- 投稿表格和作品元数据；
- 全剧看点和全剧梗概；
- 人物小传；
- 用户补充的时代、地点、风格和创作要求；
- 已创建的 Episode source revision 摘要。

### 输出

- Series source context；
- 全局人物及别名索引；
- 全局时间线和阶段；
- 主线、支线和关系弧；
- 跨集伏笔和未决问题；
- 全局地点、年代和世界规则；
- `series_context_revision` 和采用状态。

### 一致性保障

- 投稿前言不进入 Episode 原文；
- 全局梗概中的结局不能被标记为第一集已发生事实；
- 每个跨集判断必须带来源集号、事件或 `interpretation` 状态；
- Series draft 保存后不自动成为 Episode 的已确认事实。

### 摘要检索

优先检索 Series Context 的人物、关系、时间阶段、伏笔和地点索引。需要证明原文时，回到对应 Episode source range。

## 阶段二：Episode 场景原文与结构化解析

### 目的

确定本集真正的文本边界和可检索结构。

### 输入

- 当前集原始剧本；
- Series 分集边界和 handoff；
- 用户确认的前言/场景起始范围。

### 输出

- Episode source revision；
- 场景 heading、时间、地点；
- 本集出场人物和道具；
- 本集候选事件、对白和动作；
- source range 和 Unicode 索引；
- Episode Context draft。

### 一致性保障

- 原文只读，结构化解析不能覆盖原文；
- chunk 边界不是语义场景边界；
- 未识别的场景边界进入待确认，不静默切断；
- 同一人物的别名和时期变体绑定到 canonical entity；
- 解析失败时保留原文和已完成批次。

### 摘要检索

先检索场景级摘要和事件索引，再回到原文范围核对对白、动作、时间和地点。

## 阶段三：长文分片与摘要记忆

### 目的

在输入预算有限时保持顺序、覆盖和连续性，不把压缩摘要误当作完整剧本。

### 输入

- Episode source revision；
- 场景和段落边界；
- 当前分片策略版本；
- Series Context 相关投影。

### 输出

每个 source chunk 保存：

- `source_ref` 和 `[char_start, char_end)`；
- 局部事件和参与人物；
- 地点、时间和状态；
- `continuity_in` / `continuity_out`；
- facts、open threads；
- map 模型原始返回和 digest hash。

### 一致性保障

- 先按场景和段落切分，再应用字符/token预算；
- 关键事件不得只依赖 head/tail anchor；
- chunk 摘要不能删除人物、关系变化和事件顺序；
- 摘要超限时优先删除冗余格式，不删除来源范围；
- 保存 direct、map_reduce 或 auto 实际模式；
- 同一剧本支持 direct / digest A/B，不先假定固定阈值正确。

### 摘要检索

摘要用于召回候选片段、定位人物和事件。任何影响导演判断的结论，都必须回指 chunk 或原文范围。

## 阶段四：Series Director Understanding

### 目的

确认全剧的故事理解和导演总纲。

### 输入

- Series source context；
- 所有 Episode 的结构化摘要；
- 全局实体索引；
- 用户补充的全局问题和视觉锚点。

### 输出

- 全剧时间线；
- 人物关系变化；
- 主线/支线和伏笔；
- 全剧叙事重点、节奏和连续性；
- Series Director draft / confirmed revision。

### 一致性保障

- 只产生全局理解，不替 Episode 写入局部事件；
- 模型返回先进入 draft；
- 未确认的 Series draft 不进入 Episode 拍摄计划；
- 用户修改 Series 理解后，只标记相关 Episode stale；
- Series revision、摘要 hash 和来源集号必须保存。

### 摘要检索

Episode Director 只读取与当前集人物、阶段、地点和伏笔相关的 Series 投影，不重复提交整部剧本。

## 阶段五：Episode Director Understanding

### 目的

在全剧总纲约束下，分析当前集真正发生了什么。

### 输入

- 当前集原文或 source digest；
- 已确认 Series Director Understanding；
- 本集实体和 fact ledger；
- 当前集用户问题、回答和局部修改。

### 输出

- 本集事件和时间线；
- 本集出场人物关系；
- 本集剧情线和场景分析；
- 本集 continuity、prohibitions、unresolved questions；
- Episode Director draft / confirmed revision。

### 一致性保障

- 全局内容是只读 handoff；
- 只有当前集原文明确出现的事件才能进入本集事实层；
- 全剧结局、人物小传和未来事件只能作为 `interpretation` 或 unresolved；
- 本集修改不回写 Series 原文；
- 同一场景的事件顺序、人物状态和时间地点必须可回指 source range。

### 摘要检索

检索顺序：当前场景摘要 → 当前集事件 → Series 相关关系/伏笔 → 原文证据范围。

## 阶段六：Director Intent 与连续性

### 目的

把已确认的故事理解转为可执行的导演意图，不重新改写剧本。

### 输入

- 已确认 Series / Episode Director revision；
- 视觉风格摘要；
- 用户补充的视觉锚点、表演、声音和节奏要求；
- continuity ledger。

### 输出

- 视觉、表演、声音和节奏方向；
- 可选的场景环境建议；
- 连续性约束和禁止项；
- Director Intent revision。

### 一致性保障

- 导演意图可以艺术加工，但不能伪装成剧本事实；
- 不直接生成并写回新的剧本对白；
- 空的环境音、道具或效果字段允许留空；
- 用户拥有接受、修改或忽略建议的决定权。

### 摘要检索

拍摄计划只读取已采用的执行摘要、相关场景和连续性约束，不读取未采用草稿。

## 阶段七：Shooting Plan 分片生成

### 目的

把已确认的 Director 理解和意图转换为 scene → beat → shot 拍摄计划。

### 输入

- Episode source revision；
- 已确认 Series / Episode Director revision；
- Director Intent 和视觉风格摘要；
- 当前集实体库；
- 上一批次 `continuity_out`；
- 当前 batch 的 scene/beat source refs。

### 输出

- 拍摄场景；
- 戏剧节拍；
- 镜头顺序、时长和视觉意图；
- 人物、场景、道具引用；
- camera、lighting、performance、dialogue、sound；
- 下一批次 handoff；
- Shooting Plan revision 和 generation attempt。

### 一致性保障

- 按 scene/beat 边界分批，不按任意字符截断；
- 每批必须记录 input lineage 和 token 预算；
- 前一批 `continuity_out` 必须进入下一批 `continuity_in`；
- 计划引用不存在的实体时保留 unresolved，不拒绝整份计划；
- 空的环境音、道具或效果字段允许保存，后续可在分镜阶段补齐；
- 已完成批次不重复生成；
- 拍摄计划不反向修改剧本和 Director Understanding。

### 摘要检索

每批读取：

```text
当前 scene summary
+ 当前 beat/event
+ 已确认导演执行摘要
+ 相关角色/场景/道具
+ 上一批 continuity handoff
```

不把整集全文和所有历史批次重复发送给模型。

## 阶段八：Storyboard / Assets 执行

### 目的

把已确认拍摄计划转成可编辑分镜、资产和生成任务。

### 输入

- 已确认 Shooting Plan revision；
- scene / beat / shot lineage；
- 当前资产库；
- 视觉风格和参考素材规范。

### 输出

- 一镜一帧或明确拆分后的 Storyboard frame；
- 角色、场景、道具绑定；
- 图片/视频提示词；
- generation attempt、provider task ID 和结果 artifact。

### 一致性保障

- Storyboard apply 是独立用户动作；
- 不重新解释已确认 shot；
- 资产 ID、参考素材和 `@原始文件名` 显式绑定；
- 生成失败只影响当前任务，不丢失已确认计划；
- 结果保存 source lineage、Director revision 和 provider task ID。

### 摘要检索

执行阶段优先使用结构化 shot 字段和资产 ID；需要修改时回到对应 Director / Shooting Plan revision，而不是重新读取整部剧本。

## 版本与审计字段

每次阶段请求至少记录：

```json
{
  "series_context_revision": 3,
  "episode_source_revision": 1,
  "episode_source_revision_id": "source-r1:...",
  "director_profile_revision": 4,
  "director_profile_hash": "...",
  "source_mode": "auto",
  "chunk_ranges": [],
  "digest_sha256": "...",
  "preset_id": "director-interpretation",
  "preset_revision": "...",
  "generation_contract_version": "director-shooting-plan-v1"
}
```

这些字段用于恢复、A/B、diff、stale 判断和问题定位。它们不应成为阻止用户正常编辑的额外 gate。

## 对用户展示的简化文案

> **先确认全剧理解，再分析当前集。**
>
> 系统会把投稿资料、全剧梗概和人物小传保存为系列级理解；每一集只分析本集场景正文。摘要用于快速检索，原文范围用于核对证据。确认后的导演理解才会进入拍摄计划。
>
> **拍摄计划按场景和节拍分批生成。**
>
> 每一批都会继承上一批的人物状态、时间地点、道具和连续性。模型返回后先保存结果和来源，用户可以修改镜头效果、声音和环境细节，再继续分镜执行。

## 经验提示层：帮助用户判断，不替用户创作

iframe 可以提供常见导演和编剧方法的知识库提示，帮助用户更快发现需要检查的位置。这些提示属于辅助信息，不是剧本事实、导演决定或自动改稿指令。

### 可提示的编剧检查

- 开场是否建立了人物、关系和核心问题；
- 当前段落是否有明确的剧情钩子或悬念；
- 事件是否改变了人物目标、关系或信息状态；
- 中段是否出现新的阻力、选择或反转候选；
- 结尾是否留下下一阶段的问题、情绪余波或行动动机；
- setup、progress、turn、reveal、payoff 是否有来源事件支撑；
- 对白是否承担信息、冲突、人物关系或节奏功能；
- 是否存在重复事件、无效场景或人物动机断点。

提示文案应使用“可检查”“候选”“可能需要增强”等表达，不使用“必须这样写”。

### 可提示的导演和视觉检查

- 这一场的视觉重点是什么：人物关系、空间关系、动作、信息揭示还是情绪变化；
- 是否需要建立镜头、反应镜头、细节镜头或空间转场；
- 场景的时间、天气、光线、色彩和材质是否支持当前情绪；
- 人物站位、视线、运动方向和剪辑衔接是否连续；
- 哪些内容适合通过画面表现，哪些内容仍应由对白或声音承担；
- 场景是否缺少可供观众理解空间和关系的视觉锚点；
- 是否存在可选的环境、道具或动作细节增强点。

视觉提示不能凭空新增城市、年代、人物、道具或事件。若建议超出原文，应标记为：

```text
optional_director_addition / 用户可选视觉锚点
```

### 提示卡片的固定结构

每条经验提示至少包含：

```text
提示类型：剧情钩子 / 关系 / 节奏 / 视觉 / 连续性
观察对象：scene / event / beat / shot
依据：source_ref、Director revision 或知识库条目
提示：用户可以检查什么
可选动作：接受、修改、忽略、标记待定
状态：suggestion / accepted / edited / dismissed
```

知识库条目也要带版本和适用范围。经典编剧理论、镜头语言和类型惯例只能作为参考，不得作为缺失时的硬 gate。

### 用户决定权

- 提示不会自动改写剧本原文；
- 提示不会自动确认 Director revision；
- 提示不会自动生成或替换拍摄计划；
- 用户可以保留原状，也可以只采纳某一条建议；
- 用户接受的建议进入明确的 Director draft 或 Shooting Plan draft，并记录来源和 revision；
- 被忽略的建议不应在下一次分析中反复强制出现，除非用户主动重新打开知识库提示。

### AI 修改的三种用户动作

故事、视觉和镜头的 AI 修改都先进入候选 revision。用户可以：

1. **接受 AI 修改**：采用候选 revision，并保留原版本与 diff；
2. **继续修改**：以候选 revision 为起点继续编辑，形成新的用户 revision；
3. **删除 / 拒绝**：删除候选 revision，继续使用此前采用的版本。

接受不是永久锁定，删除也不影响剧本原文和历史版本。每次动作记录来源 revision、AI candidate revision、用户动作、结果 revision、diff 摘要和时间。

### 产品定位文案

> iframe 帮你整理剧本、追踪上下文、生成结构化草稿、保存版本并提示可能需要检查的位置。它不会替你决定故事，也不会把经验规则当成唯一答案。最终的剧情、视觉和镜头选择由你确认。

## 不做的事情

- 不依赖模型聊天 session 维持长期记忆；
- 不把 Series 摘要当作 Episode 原文；
- 不把 chunk 摘要当作完整剧本；
- 不因为一个可修复的实体或创作字段问题拒绝整份计划；
- 不自动改写剧本原文；
- 不用固定“每分钟多少字”替代 source range、token 和事件边界测试。
- 不把编剧理论、导演经验或知识库提示当作事实或强制 gate。
- 不以自动生成完整作品作为产品目标；系统优先自动化整理、追踪、比对和可恢复的重复工作。
