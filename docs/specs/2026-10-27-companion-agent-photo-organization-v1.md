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
