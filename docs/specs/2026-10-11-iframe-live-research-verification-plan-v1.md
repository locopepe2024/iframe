# iFrame 联网研究验证计划 v1

日期：2026-10-11。基线：`c35cef2bf2365bcc397e7ecccf0ba590d235bc44`（PR #80、#83 已合并并部署）。本计划只验证联网研究链路；记忆去重分支的改动单独评估。生产发现服务和采集白名单当前关闭。实施边界见 `2026-10-11-iframe-live-research-implementation-v1.md`。

## 目标与证据级别

验证需求解析、候选发现、用户选源、独立 worker 采集、owner 隔离、原文单元入库和引用回答。每项结果标记为 `代码/测试事实`、`部署运行观察` 或 `真实来源端到端观察`。单元测试通过不等于外部服务可用；引用 ID 有效不等于结论被原文支持。

| 阶段 | 环境与执行 | 通过标准 | 不能证明的事 |
|---|---|---|---|
| A. 离线契约 | 固定 GDELT 响应、网络桩、临时 SQLite、mock worker；运行下列后端和前端测试 | 日期窗/歧义处理、候选标记、白名单与私网阻断、跳转复检、owner 范围、任务状态、引用 ID、UI 开关和恢复行为均通过；无真实外部请求 | GDELT 可用性、站点权限、真实网络采集 |
| B. 一次性数据库集成 | PostgreSQL 测试实例，v1-v3 迁移和回滚事务；独立 API/worker 测试配置与隔离的对象存储 | 任务跨事务可领取并完成；A/B 不可互读；重启后任务可恢复；原文及单元引用保持同一 revision；测试数据清理可核对 | 生产站点内容和真实模型回答质量 |
| C. 生产只读检查 | 保持 provider 和 hosts 为空；只读核对版本、健康、schema v3、worker 状态和功能不可用提示 | 后端/静态版本一致；worker 无异常重启；未授权用户不能启用联网研究；没有采集任务或外部调用 | 完整联网路径 |
| D. 受控外部 smoke | 先核验 GDELT 条款、响应、限额，以及一个站点的访问与存储/引用权限；仅在隔离环境配置精确 HTTPS 主机名和单个测试用户 | 真实发现结果可追溯；用户选源后 worker 入库；回答只引用实际入库单元；失败码和清理记录齐全 | 长期稳定性、财务数字准确性、普遍适用性 |

## 执行顺序

1. A1 后端：`/Users/owen/Developer/codex/iframe/.venv/bin/pytest -q tests/test_knowledge_research.py tests/test_knowledge_api.py tests/test_knowledge_postgres.py tests/test_knowledge_research_postgres.py tests/test_agent_chat.py`。记录通过/跳过数及跳过原因；无测试数据库时不得把跳过写成通过。
2. A2 前端：`npm --prefix frontend run test:ui -- src/components/modules/playground/AgentComposer.test.tsx src/components/modules/playground/useAgentConversation.test.tsx src/components/modules/playground/SessionTimeline.test.tsx`；`npm --prefix frontend run test -- --run src/__tests__/agent-request.test.ts`；`npm --prefix frontend run typecheck`。记录精确结果。
3. B1 仅用一次性 PostgreSQL socket 设置 `IFRAME_KNOWLEDGE_TEST_PG_SOCKET`，运行数据库契约测试；确认该测试将写入包在 rollback 中。若要验证 API/worker 双进程和对象存储，使用专用测试凭证与独立前缀，不复用生产用户数据。
4. C1 只读核对部署事实；不改环境变量、不重启服务、不触发外部抓取。将部署观察与本地测试结果分开记录。
5. D1 在核验记录具备后执行。核验记录必须包含发现服务的访问条款、限额、一次带时间范围的响应格式；来源站点的精确主机名、访问/存储/引用权限、跳转目标、返回类型与大小。限定一条查询、最多一个候选、一位测试用户；记录 run/job/source/revision/unit ID 和失败码，不保存凭证或页面全文到文档。完成后关闭隔离配置并核对无残留任务。

## 失败与停机条件

- 任一私网、非白名单或跳转目标被采集，或跨 owner 泄露，立即停止该阶段并修复。
- 任务显示完成但缺少原文 revision 或引用单元，视为失败；不能用模型回答掩盖采集失败。
- GDELT 对指定日期范围返回不支持、限流或空结果，按实际错误记录，不改写为“无新闻”。2026 年 3 月资料在当前日期超出该适配器精确日期窗。
- 无原文支持的句子、发布日期与 seen time 混淆、单位/期间缺失的财务数字，标记为未证实；引用语法通过不构成真伪验证。

## 执行记录

| 阶段 | 状态 | 证据与限制 |
|---|---|---|
| A1 | 已完成 | 本地 55 通过、2 跳过。跳过项分别需要生产式 PostgreSQL 凭证/CA 和一次性 PostgreSQL socket；后者在 B1 单独补跑。测试工作树包含尚未合并的记忆去重提交 `f4fc1594`，该提交未改联网研究实现。 |
| A2 | 已完成 | Playground 组件 27 通过，请求层 2 通过，`typecheck` 通过。首次类型检查生成 Next.js 类型并完成静态构建；仅有现有 export/rewrites 提示。 |
| B1 | 部分完成 | 一次性 PostgreSQL 18 上 `test_knowledge_research_postgres.py` 1 通过；实例已关闭。首次尝试受沙箱 Unix socket 限制，提权重试通过。该测试覆盖 v1-v3 迁移、任务领取/完成、原文单元与 A/B 隔离，使用回滚事务；尚未执行独立 API/worker 双进程与隔离对象存储测试，也不能替代生产 PostgreSQL 16 验证。 |
| C1 | 用户报告已完成部署核对，待独立只读核对 | 部署版本、schema v3、worker 与三项 CI 均来自用户报告。 |
| D1 | 未进入 | provider 与白名单保持关闭；来源服务和站点尚待核验。 |
