# Recreation P0 工作区恢复切片 v1

日期：2026-09-26

状态：Implementation spec

## Observed

- `RecreationPage` 首次加载只请求项目列表，不恢复上次打开的项目。
- 刷新后没有保存当前阶段；`open()` 会按项目状态重新推导阶段。
- 当前项目和阶段只存在 React state 中，浏览器刷新会丢失工作上下文。
- 后端已有 owner-scoped 项目查询，恢复项目不需要新增身份或存储系统。

## Direct implication

- 可以在浏览器本地保存当前项目 ID 和当前工作阶段，刷新后通过现有 `GET /recreation/projects/{id}` 恢复。
- 本地恢复只保存导航上下文，不保存媒体内容、签名 URL、任务结果或付费授权。
- 如果项目已删除、无权限或请求失败，必须清理失效的本地 ID，并回退到项目列表，不阻塞其他项目加载。
- 自动分析轮询和任务状态仍以服务端数据为准；本切片不把本地状态当作任务事实。

## Not yet proven

- 本地恢复不会证明异步任务已恢复；任务恢复仍由现有服务端任务列表和 `ShotReferences` 逻辑负责。
- 本地恢复不会验证真实浏览器多标签页竞争；同一浏览器多个标签页的最后写入策略保持未定义。

## Scope

- 新增 Recreation 工作区 session key 和受限 JSON 解析。
- 保存当前项目 ID 与六阶段工作区阶段。
- 首次加载项目列表后尝试恢复项目；恢复失败则清理本地上下文并保持列表可用。
- 用户切换项目、切换阶段、上传新项目时更新上下文。
- 不修改后端 API、任务契约、媒体签名或付费流程。

## Success criteria

1. 刷新 Recreation 页面后，仍打开上次项目并停留在上次阶段。
2. 已删除或无权限的项目不会造成死循环、错误覆盖或空白页面。
3. 本地上下文只包含项目 ID 和合法阶段，不接受任意字符串注入 React 状态。
4. 现有项目列表、分析轮询、任务恢复和上传流程回归通过。

## Verification

- `cd frontend && npm run test -- RecreationPage.test.tsx`
- `cd frontend && npm run typecheck`
- `git diff --check`

