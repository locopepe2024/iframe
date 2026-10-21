# 老人照片 V1-A：时间相册工程契约草案

日期：2026-10-21
状态：下一实现切片的工程草案，未实现、未部署。采用 iFrame FastAPI 作为候选服务，移动网页作为交互入口；不据此宣布存储部署或身份方案已最终确定。

上游基线：`/Users/owen/Developer/codex/docs/photo-organization-mvp-2026-10-21.md`。
模型/Skill 梳理：`/Users/owen/Developer/codex/docs/photo-album-memory-model-skill-map-2026-10-21.md`。
CopilotKit 评估：`/Users/owen/Developer/codex/docs/copilotkit-companion-evaluation-2026-10-21.md`。

## 已观察与实施边界

代码事实：现有服务提供 require_user_context / owner_profile_id；知识资料模块提供 owner 范围的 PostgreSQL collection/source 查询；它没有照片批次授权与撤销状态机。前端静态导出，不能直接部署 CopilotKit 指南中的 Next 服务端 API route。

本切片目标：上传 → 单批时间整理授权 → 持久化任务 → 日期归档 → 年份/待确认浏览 → 日期更正 → 撤回和撤销。模型、人物分析、照片内容理解、记忆唤醒和写作不在此切片。服务应能独立于 CopilotKit/AG-UI 供普通表单与语音确认卡调用。

未证明：现有数据库配置/生产存储是否适用于家庭照片留存；既有身份是否覆盖老人独立登录和家庭共享。首轮用测试身份及合成照片验证契约，不连接真实老人照片或默认公开文件目录。

## 数据责任

- Photo：owner、id、原图/缩略图内部 object key、内容摘要、上传时间、原始 EXIF、解析结果和状态；不能把原图路径当公开 URL。
- Batch 与 BatchPhoto：批次不可变清单，每个文件有独立上传状态；一个已存在 Photo 可被多个批次引用。
- Consent：owner、batch、scope=time、问题版本、披露的处理位置、granted/declined/revoked、确认方式/时间。人物 scope 不在本期开放。
- TimeTask：owner、batch、consent_id/version、幂等键、状态、逐照片进度/错误、租约和重试次数；重启恢复以数据库为准。
- DateAnnotation：拍摄值、year/month/day/second 精度、来源 EXIF/user、候选/确认状态、原始元数据引用、修订版本；未知就是空值，不补齐月日。
- AlbumRelation 与 Operation：记录此批新增的关系、任务来源和撤销状态；同一 photo/year 关系可有多个有效来源，撤销一批不移除另一批仍有效的结果。

数据库是授权、任务和已确认标注的事实源。原图存储受保护，缩略图按 EXIF 方向生成；日期归档不移动或重写原图。只在授权后进行时间整理，上传阶段仅做文件校验/缩略图和必要元数据保存，不创建相册关系。未获人物授权绝不执行检测、特征或聚类。

## API 候选（命名可在实现时按项目约定调整）

| API | 目的与约束 |
| --- | --- |
| POST /photos/batches | 建立 owner 范围的批次；幂等键防止重复 |
| POST /photos/batches/{id}/photos | 逐文件上传，分别返回成功/失败；重试不重复同一上传项 |
| GET /photos/batches/{id} | 返回上传、授权、任务状态与逐文件错误；跨 owner 一律不可见 |
| POST /photos/batches/{id}/time-consent | 确认当前批次/版本的时间授权；拒绝同样有明确状态 |
| POST /photos/batches/{id}/time-tasks | 必须有有效授权；事务持久化任务后由 worker 领取；返回任务 ID |
| GET /photos/tasks/{id} | 任务状态和真实统计；不得由模型编造结果 |
| GET /photos/albums | 按确认年份/待确认过滤、分页；不将上传年份当拍摄年份 |
| PATCH /photos/{id}/date | 接受年份、年月或完整日期；校验精度和值一致，以 expected_revision 防止覆盖 |
| POST /photos/batches/{id}/revoke | 撤回授权并取消尚未提交项；事务内阻止旧授权版本提交 |
| POST /photos/batches/{id}/undo | 只撤销本批新增关系/自动标注，原图和此前确认结果保留；幂等 |
| GET /photos/{id}/thumbnail | 认证并验证归属后返回；private/no-store，不使用公开 /files 目录 |

原图删除另行设计和确认，不随整理/撤销执行。身份由服务端认证决定，所有模型/客户端传入 owner 字段不被信任。数据存储不可用应明确失败，不静默降级为浏览器本机保存或另一数据源。

## 状态、并发和失败

- 授权与任务分开：任务 waiting/running/pending_confirmation/completed/partial_failed/failed/cancelled；没有日期的照片进入待确认，不算处理故障。
- 先提交数据库任务记录再向 worker 可见；租约到期可重领，逐文件事务提交。对 task/photo/operation 使用唯一键或受约束 upsert，实现至少一次执行下的幂等。
- 每次结果提交与授权核验在同一事务/锁边界中完成；撤回成功后旧授权版本的任务不能再新增结果。不得仅在模型调用前检查一次。
- 用户确认过的日期先于新 EXIF 解析；重跑不覆盖。更正用版本检查并记录来源；日期与相册关系的更新必须一致。
- 撤销按操作来源回滚；部分失败保留已成功部分和重试入口。不得用删除整张照片或整个年份相册代替撤销。
- 照片不因一个文件失败而整批丢失。上传字节上限、图片格式/解码限制和去重键需在实现切片中固定，并以测试覆盖。

## 日期规则

原始 DateTimeOriginal 等元数据保留来源和值，解析失败、相互冲突或日期非法时待确认；无时区值不能伪装成 UTC。上传时间始终另存。人工输入“1980”只保存年精度，“1980-05”只保存月精度；不能为排序存入虚构 01 日。未明确说明时不依据画面服饰/年龄生成日期。

## 交互与 CopilotKit 边界

移动网页照片入口先可用普通 React 表单；一次只问一个问题，显示处理位置，提供暂时不用。授权问题独立于普通聊天，不允许无关联“确认”执行任务。

CopilotKit 候选试验以“字号设置确认”和“单批时间授权”两种受控卡片为限；模型只能提议，后端返回的实际授权/任务状态决定显示内容。框架试验需先通过 React 18/静态导出兼容测试、真实模型 tools 往返测试，再考虑接入默认入口。人物与回忆卡片后置。

## 验证命令与成功标准

待实现路径：`src/apps/photos/`、`tests/test_photos_*.py`、`frontend/src/components/companion/photos/`；仅在主 app 注册独立路由，不改现有知识库或创作台数据责任。

1. pytest 覆盖：上传未授权；无 EXIF；非法/冲突 EXIF；年/月精度；跨 owner；幂等重试；撤回与提交竞争；原图保留；同照片跨批次结果保留；用户确认不被重跑覆盖；重启领取任务与部分失败恢复。
2. 前端交互测试：拒绝不触发任务；等待/失败/取消有恢复路径；刷新从服务端恢复；年份显示不补月日；授权和实际状态一致。
3. `npm run typecheck`、定向 `npm run test:ui -- <photos tests>`、`npm run build`。
4. 真机与老人任务测试另行记录，不以单元测试或 CopilotKit 演示代替。模型参与部分以实际授权样本验证。

本文件只有工程契约，未宣称上述 API、worker、上传或任务恢复已实现。
