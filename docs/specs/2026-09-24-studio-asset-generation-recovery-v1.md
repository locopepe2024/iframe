# Studio 资产生成恢复契约 v1

## 目标与边界

本契约覆盖 Studio 项目中的角色、场景、道具图片生成任务：提交、持久化、进程重启恢复、超时失败、重试、人工清理，以及前端轮询恢复。它不覆盖视频任务、Recreation SQLite 任务，也不删除资产文件或图片变体。

## 观察到的事实

- **代码事实**：项目资产和其 `status` 保存在 `projects.json`；异步图片任务及提交参数只保存在 `ComicGenPipeline.asset_generation_tasks` 内存字典。提交时会先把资产状态写为 `processing`，然后才排入 FastAPI `BackgroundTasks`。
- **代码事实**：启动恢复 `_recover_orphan_tasks()` 目前只扫描持久化的视频任务。资产任务在重启后丢失 task ID，`GET /tasks/{task_id}` 无法恢复其状态。
- **代码事实**：`ConsistencyVault` 将 `generatingTasks` 放进 Zustand 持久化状态，但记录没有 task ID / project ID；生成失败时会重新读取整份项目。刷新后没有足够信息恢复原任务轮询。
- **代码事实**：资产生成器逐步写入图片变体；异常可能发生在部分变体写入之后。变体、选中变体 ID 和旧版图片 URL 与任务状态是不同的数据。
- **运行观察（2026-09-24）**：线上 `/health`、`/openapi.json` 和 `/projects/{script_id}/assets/{asset_type}/{asset_id}/generation/clear` 路由可用；已核对 9 个项目中存在 completed、failed、pending 资产，未核实相关媒体文件是否实际可读。前端静态目录同步来自用户提供的信息，本轮未独立校验哈希。

## 状态分离

任务状态和资产可用状态必须分别表达：

| 对象 | 状态 | 含义 |
|---|---|---|
| 生成任务 | `pending` / `processing` | 任务排队或正在执行 |
| 生成任务 | `completed` | 生成调用正常结束；不表示每个 batch 项都成功，也不证明媒体文件现在可读 |
| 生成任务 | `failed` | 调用异常、上游超时或重启孤儿回收；可能已留下部分变体 |
| 生成任务 | `cleared` | 用户已清除终态任务标记；原任务不会继续轮询 |
| 资产 | `processing` / `failed` | 资产当前生成流程仍在执行 / 最近流程失败；不代表变体不存在 |
| 资产 | `completed` | 当前选中变体 ID 能在该资产的变体集合中解析，且变体有 URL |
| 资产 | `pending` | 没有可解析的当前选中变体；已有的非选中或半成品变体仍保留 |

图片索引单独诊断：`selected_image_id` / `selected_id` 未设置且没有旧版图片 URL 为 `empty`；能解析到带 URL 的变体为 `valid`；ID 无对应变体或对应变体无 URL 为 `stale`；没有结构化选择但有旧版图片 URL 为 `legacy`。`valid` / `legacy` 只证明持久化引用存在，不证明 URL 背后的文件可读取。不能因为任务失败而推断索引过期，也不能因为索引过期而把任务改报失败。

## 状态转换与恢复

```text
任务: pending -> processing -> completed | failed -> cleared
                     |              |
                     +--重启--------+ (若持久化状态仍为 pending/processing，则恢复为 failed)
资产: pending -> processing -> completed | failed
                              清理后 -> completed (当前选择有效) | pending (否则)
```

- 每个资产持久化最近任务的 task ID、任务状态、错误和时间戳。task status API 必须能从该记录重建重启前的任务，并返回目标资产快照，包括 failed/cleared 的半成品快照。开始新一轮任务后，旧 task ID 不再代表当前资产任务。
- 启动时将持久化的资产任务 `pending` / `processing` 归为 `failed`，记录清晰的重启原因并持久化；保留 task ID、已有变体和文件。旧数据只有 `asset.status=processing` 而无任务记录时也要停止显示处理中，并给出可清理/重试的失败状态。
- provider / CLI 已有的有限连接、轮询或子进程期限触发异常后，任务进入 `failed`。不设一个未经模型耗时数据验证的总任务租约：请求线程无法被安全强制终止，错误租约可能让仍运行的 worker 与重试/清理并发写同一资产。
- 重试是一次新的生成提交，分配新的 task ID。只有上一次没有活动 worker（或已经终态）时才可开始；不复用旧 task ID，也不自动重跑失败任务。
- 清理仅允许在任务已终态，或排队任务已在原子检查中被阻止执行时进行。清理只把任务记为 `cleared`、清除错误并将资产状态按当前选中索引恢复为 `completed` 或 `pending`；不删除文件、变体、上传素材或索引。运行中的 worker 不可被人工清除冒充停止。

## API 与前端行为

- `POST /projects/{script_id}/assets/{asset_type}/{asset_id}/generation/clear`：按项目/资产定位；鉴权沿用项目访问规则；活动任务返回冲突；响应包含清理后的目标资产和任务记录。
- `GET /tasks/{task_id}`：资产任务在所有终态返回 `task_id`、状态、错误、资产标识、来源、索引诊断及单资产快照；不得为了任务轮询读取整份项目。
- 前端持久化 `task_id`、`project_id`、资产类型/ID和生成类型；恢复时用原 task ID 继续轮询。短暂网络错误继续轮询，任务 404 / 清理 / 失败等服务端终态必须停止轮询。
- 失败结果用任务返回的单资产快照更新当前 store，不通过整项目重新拉取掩盖任务失败。失败资产提供“重试”和“清除失败状态”操作，并明确保留半成品；索引 stale 单独提示。

## 验收标准

1. 重启恢复测试证明 `processing -> failed` 已持久化，task ID 可查询，部分变体留存。
2. provider timeout 测试证明任务进入 failed 且错误可见；没有活动 worker 的孤儿任务可清理，活动 worker 不可清理。
3. 清理测试覆盖当前选择可解析时回到 `completed`、无效/空选择时回到 `pending`，并证明不删除变体。
4. task status API 对失败任务返回单资产快照，不调用整项目查询。
5. 前端测试覆盖 task ID 持久化/恢复、404 停止轮询、失败快照合并，以及清理操作不删除素材。
