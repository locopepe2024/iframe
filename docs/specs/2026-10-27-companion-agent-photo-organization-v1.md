# Agent 相册整理 v1

## Observed

- Companion Agent 当前只注册 memory.save/search/list/delete 工具，没有相册工具。
- 相册后端已有按用户隔离的照片列表、日期、描述、故事、人物候选与纠错、历史和撤销接口。
- 日期与人物整理已有“预览 → 明确确认 → 写入”的边界；描述和故事也有 revision/history。

## Direct implication

Agent 不应直接修改照片。它需要调用一个受限的 photo tool registry：读取可以自动执行；分析必须沿用现有外发确认；任何日期、人物关系、结构化备注或故事写入都先生成预览卡片，用户确认后才提交。

## Tool groups

### Read-only

- `photo.album.list`：按月份、是否待核对、媒体类型和文字搜索分页。
- `photo.item.read`：读取缩略图、日期状态、分析、描述、故事和 revision。
- `photo.history.list`：读取日期/描述/故事/人物修改历史。

### Proposal-only

- `photo.analyze`：对用户选中的 photo_id 调用视觉模型，返回可观察事实、候选日期、人物候选、关键词和不确定项；现有分析接口会保存待核对的模型观察，因此本期沿用该接口的明确确认，不注册自动执行工具。
- `photo.organize.preview`：把日期、结构化备注、人物归类、故事草稿合并成一张预览卡片，带 photo_id、expected_revision、operation_id。

### Confirmed write

- `photo.organize.confirm`：只接受预览 token 和用户确认，按 revision 检查提交；冲突时重新读取，不覆盖用户新修改。
- `photo.organize.undo`：只撤销最近一次可逆修改，不删除原文件。

## Conversation examples

- “帮我整理这几张照片” → Agent 先说明范围，读取选中照片并生成分析/待确认卡片。
- “把没有日期的照片找出来” → 直接查询并展示待核对列表，不自动猜日期。
- “这几张是我女儿” → 生成人物归类预览，要求确认；不把视觉相似度直接当作身份事实。
- “给这张照片加个备注：去年春节在家里” → 形成结构化备注草稿，确认后保存并保留历史。
- “删除这张照片” → Agent 只能说明当前版本不提供原文件删除；可提供从相册隐藏/取消整理的后续设计。

## Safety and success criteria

- 工具始终 owner-scoped；photo_id 不跨用户解析。
- 任何写操作必须有确认、operation_id 和 expected_revision，重复提交不产生第二次修改。
- 原始照片不可被 Agent 删除或覆盖。
- 模型观察、用户确认事实和用户原话分开保存；不把模型猜测写成记忆。
- 首个可测切片：`photo.album.list` + `photo.item.read` + 照片整理卡片；分析与讲述复用现有确认入口。首期查询按年份、缺少年份及已保存文字筛选；不支持月份、视频或图像语义搜索。

## Not yet proven

- Qwen 多模态对老人照片的日期、人物和场景分析准确度。
- Agent 通过自然语言选择多张照片的歧义处理。
- 批量分析在浏览器和 CPU 服务上的延迟。

## 语音交互 Agent 与工作流 Agent 的边界（2026-10-27 澄清）

小安是用户交互入口，相册整理由工作流 Agent 承接。此处为目标设计，当前已实现首个持久化相册工作流：查询候选 → 等待选择 → 打开核对/讲述工作域 → 结束或取消。后续分析与修改的统一编排、语音直接推进任务仍待接入。

- 小安：接收语音识别后的文字或文字输入，理解目标、询问缺失信息、展示卡片、播报简短进度；持有当前 task_id，不自行展开多轮照片分析或猜测任务完成。
- 工作流 Agent：接收用户身份、目标、明确选中的素材范围和输入消息标识；通过受限工具执行查询、分析和整理，维护步骤、等待确认、失败重试及取消状态。
- 工具与存储：复用现有 owner-scoped API、分析授权、revision、operation_id 和修改历史，不因 Agent 之间交互绕过确认。
- 工作流不要求每步再次调用 LLM。确定性的查询、校验和提交直接运行；有歧义的规划或视觉分析才调用模型。

统一任务协议：start_task / get_task / provide_input / confirm_step / cancel_task。任务返回 task_id、status、当前步骤、结构化结果卡片、所需用户输入和简短播报建议。status 为 queued / running / waiting_input / waiting_confirmation / completed / failed / cancelled。

示例：“帮我整理没有日期的照片” → 小安发起任务 → 工作流查询并返回照片范围卡片 → 用户选择照片 → 工作流请求必要分析授权或日期补充 → 返回整理预览 → 用户确认 → 工作流按版本提交 → 小安播报实际结果。

中途用户继续聊天不应丢失任务；恢复或刷新可按 task_id 读取。停止播放只影响播报，不能取消工作流；取消整理才取消任务。等待用户输入期间，工作流不能自作主张写入。

下一切片验收：先将只读相册查询包为可恢复任务，覆盖任务身份隔离、请求去重、等待用户选择及取消；再接已有分析和确认写入步骤。文字与语音共用任务协议。真实语音端到端行为需要部署验证，单元测试不等同于模型规划有效。


## 本地实现及验证边界

- 模型入口 `photo.organize.start` 仅在已 claim 的聊天轮次中创建任务，与轮次结果同事务保存；普通 `/tools` 不能启动无会话任务。
- GET `/companion-runtime/photo-tasks/{task_id}` 恢复任务；POST `.../{task_id}/input` 接受 select / close / cancel、expected_revision、operation_id。
- 候选范围冻结为首批最多 12 张（默认 6 张）；本切片不含任务候选分页。独立查询卡片支持分页。
- 重试复用同一个 operation_id；历史会话读取当前任务状态。close 仅表示结束工作域，不代表照片备注已经保存。
- 工作流状态独立于麦克风和播放队列；现阶段通过按钮选择/结束/取消，不声称已支持口头“第二张”“取消整理”。OpenTalking 语音链路与任务委派的集成仍需下一步验证。
- 发布前备份 Companion DB，然后使用 `ChatStore(absolute_db_path, initialize=True)` 应用幂等建表，再启动更新后的 API；不会修改照片库表。此更新尚未部署。

## 语音继续任务切片

代码事实：AgentChat 的 onVoiceFinal 将识别文字加入发送队列，仍调用 companion-runtime chat；OpenTalkingReply 使用 agent_enabled=false，以 render-text 播放同一次 Agent 回复。因此本切片保持该路径，不新增第二次回复生成。

- claim_turn 为本轮模型输入提供同会话、同 owner/actor 最近的活动相册任务，含 task_id、revision、候选顺序及照片 ID；这些字段独立于用户原话，不改写已存消息。
- 新工具 photo.organize.input 只允许推进本会话任务，提供 select / close / cancel；operation_id 使用当前轮次 ID，模型不能自行指定。自然语言“第二张”由模型依据候选顺序选择明确 photo_id，不新增关键词路由。
- 每轮结束重新读取任务状态，结构化卡片与简短播报使用同一状态。语音模式通过现有 OpenTalking render-text 播报；纯文字模式不播放。
- 修改步骤仍由已有核对/讲述组件完成；此切片不允许模型自行写入照片事实，不表示 OpenTalking 自带 Agent 已接管规划。
- 验收：上下文不跨会话/身份，错误任务拒绝且轮次不提交，重试不重复推进；卡片刷新反映新 revision；活动任务提示可见/可听。真实自然语言选图准确率待部署实测。

## 相册与日记能力统一注册

工具目录明确声明相册、日记、记忆三组能力及说明。相册沿用现有 list/read/organize 工具；日记新增 diary.open（月历入口）、diary.list（按月查询）、diary.read（按天读取）。日记写作继续使用已有独立写作通道，保存/修改仍使用编辑器明确确认及版本检查，不提供模型直接覆盖工具。读取严格按 owner+actor 隔离，日期使用真实日历校验。

日记工具结果在聊天流展示月历入口或已保存日记卡片，语音模式通过现有 OpenTalking 播报操作提示。能力注册不等同于实际模型选择工具成功，后者仍需自然语言实测。

## 多任务上下文与语音路由（2026-10-27 澄清）

小安同时面对三类状态：普通聊天、日记工作域、相册工作流。它们不能用一个“最近意图”字段互相覆盖。

### 任务模型

- `chat` 是默认对话流，不需要 task_id。
- `diary` 是按日期的编辑任务，编辑器保存草稿和版本；用户说话只追加到日记草稿，不自动结束或保存。
- `album` 是可恢复相册任务，已有 task_id、step、revision、候选照片和取消/结束状态。
- 同一 session 可以同时存在多个任务；每个任务有 `active`、`paused`、`waiting_input`、`waiting_confirmation`、`completed`、`cancelled` 状态。
- 只有一个 `focused_task` 接收省略主语的短句，例如“第一张”“继续写”；切换任务必须通过明确语句或卡片点击。

### 路由规则

1. 先判断是否是当前任务的直接回答：例如相册卡片出现后说“第二张”，只推进相册任务。
2. 明确任务词优先切换焦点：日记、回忆、写下来切到 diary；照片、相册、整理照片切到 album；只是问候、叙述生活切到 chat。
3. 无法判断时只问一个澄清问题，不调用工具、不改变任务状态。
4. 普通聊天不会关闭或覆盖日记/相册任务；任务完成、取消或用户明确切换才改变焦点。
5. 语音与文字使用同一条路由。OpenTalking 只负责收音、转写和播放；转写文本进入 Companion Agent，由 Companion Agent 读取历史、任务上下文并调用工具。

### 上下文包

每轮发送给文字 Agent 的上下文分为四段：当前用户原话、最近聊天消息、当前 focused_task、其他未完成任务摘要。任务摘要只包含 task_id、类型、状态、步骤、revision 和下一步需要的输入，不包含未授权的照片内容或隐私原文。模型只能推进 focused_task，不能凭摘要自动完成其他任务。

### 例子

- 相册整理中，用户说“今天女儿来看我了” → 作为普通聊天事实，不修改相册任务。
- 相册整理中，用户说“第二张” → 推进当前相册任务。
- 日记编辑中，用户说“我再补充一句……” → 追加日记编辑器草稿，不发送普通聊天。
- 日记编辑中，用户说“打开相册” → 暂停日记焦点，打开相册任务；日记草稿保留。
- 同时存在日记和相册且用户说“继续” → 询问“继续写日记，还是继续整理照片？”

### 当前实现差距

现有相册任务已有 task_id/revision，但 diary 仍主要由日期意图直接进入写作通道，focused_task 和其他任务摘要尚未统一持久化。下一切片应先实现 `workflow_context` 只读快照和 focused_task 切换，再把语音转写接入文字 Agent；不再向 OpenTalking 内置模型注入聊天历史或任务工具。

## 小安需要持有的相册工作流状态

相册交互必须向 Companion Agent 提供一个只读、可恢复的 workflow snapshot。模型不能从聊天文本猜测当前照片或修改结果。

```json
{
  "task_id": "...",
  "kind": "album",
  "status": "waiting_input|waiting_confirmation|running|completed|failed|cancelled",
  "focused": true,
  "workspace": "album",
  "selected_photo": {
    "photo_id": "...",
    "position": 2,
    "revision": 3
  },
  "operation": {
    "kind": "description|story|date|person|organize",
    "draft": "...",
    "expected_revision": 3,
    "operation_id": "..."
  },
  "last_outcome": {
    "status": "succeeded|failed|conflict|none",
    "message": "...",
    "revision": 4
  },
  "next_input": "选择照片|补充描述|确认保存|重新核对"
}
```

状态推进由后端事件完成，而不是由模型自行宣称：

- `album.opened`：相册工作域已打开。
- `photo.selected`：用户选定明确的 photo_id。
- `operation.drafted`：形成日期、结构化备注、人物或讲述草稿。
- `operation.confirmation_requested`：等待用户确认，不能写入。
- `operation.started`：确认后开始调用已有照片接口。
- `operation.succeeded` / `operation.failed` / `operation.conflict`：写入、失败或版本冲突的真实结果。
- `album.closed`：关闭工作域，不等于任务完成。

小安每轮只做三件事：说明当前状态、询问 `next_input`、把用户回答交给工作流。成功或失败播报必须读取 `last_outcome`，不能根据“我已经改好了”等模型文本判定。

页面刷新时由 `task_id` 恢复 snapshot；切换到日记或普通聊天只暂停焦点，不清除相册状态。再次回到相册时仍能知道当前照片、草稿和待确认操作。任何照片写入都必须由工作流携带 `expected_revision` 和 `operation_id`，结果回写 snapshot 后才允许进入 `succeeded`。

## 端侧协调器平板验收范围（2026-10-27）

首期不追求所有移动设备兼容，指定以下浏览器和硬件作为 WebGPU 验收矩阵：

- iPad 10 代（A14）或 iPad Air 5 代（M1），iPadOS 17+，Safari 17+。
- Samsung Galaxy Tab S9（Snapdragon 8 Gen 2），Android 14+，Chrome 121+。

端侧模型先限定 0.5B 级 4-bit 路由模型；1.5B 只作为高性能平板实验项。页面启动时执行 WebGPU adapter/device 探测和可用内存/模型加载探测，不能仅依据 User-Agent 判断。探测失败、模型加载失败或设备内存不足时回退 iframe 服务端协调器，不阻断聊天、日记或相册功能。

验收指标：首次模型加载时间、单轮路由延迟、JSON 有效率、连续 20 轮内存稳定性、模型加载失败后的回退成功率。端侧模型只输出任务协调结构，不接触照片原图、不保存日记、不执行后端写操作。
