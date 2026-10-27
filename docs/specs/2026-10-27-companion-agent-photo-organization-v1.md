# Agent 相册整理 v1

## Observed

- Companion Agent 当前只注册 memory.save/search/list/delete 工具，没有相册工具。
- 相册后端已有按用户隔离的照片列表、日期、描述、故事、人物候选与纠错、历史和撤销接口。
- 日期与人物整理已有“预览 → 明确确认 → 写入”的边界；描述和故事也有 revision/history。

## Direct implication

Agent 不应直接修改照片。它需要调用一个受限的 photo tool registry：读取和分析可以自动执行；任何日期、人物关系、结构化备注或故事写入都先生成预览卡片，用户确认后才提交。

## Tool groups

### Read-only

- `photo.album.list`：按月份、是否待核对、媒体类型和文字搜索分页。
- `photo.item.read`：读取缩略图、日期状态、分析、描述、故事和 revision。
- `photo.history.list`：读取日期/描述/故事/人物修改历史。

### Proposal-only

- `photo.analyze`：对用户选中的 photo_id 调用视觉模型，返回可观察事实、候选日期、人物候选、关键词和不确定项；不写库。
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
- 首个可测切片：`photo.album.list` + `photo.item.read` + `photo.analyze` + 预览卡片，暂不自动写入。

## Not yet proven

- Qwen 多模态对老人照片的日期、人物和场景分析准确度。
- Agent 通过自然语言选择多张照片的歧义处理。
- 批量分析在浏览器和 CPU 服务上的延迟。
