# iFrame 生产真实联网研究 smoke：准备与执行单

日期：2026-10-11。状态：准备完成，真实外部链路未执行。配套[验证计划](2026-10-11-iframe-live-research-verification-plan-v1.md)与[单 owner 门控](2026-10-11-iframe-live-research-owner-smoke-gate-v1.md)。

## 当前事实

- 2026-10-11 只读检查：生产源码、后端、静态版本同为 `101eae72365752e333c31b8595cc9e6dcbb33755`；健康检查正常，worker running 且重启计数 0，知识 schema 为 v1-v3。容器内 discovery provider 和 capture hosts 都未配置。
- 本地离线测试与一次性 PostgreSQL API/worker 子进程测试通过。它们没有验证真实 GDELT 响应、HTTPS 站点采集、生产 COS 或模型对原文的支持判断。
- GDELT 官方 [DOC 2.0 说明](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/)给出直接访问 `api.gdeltproject.org/api/v2/doc/doc` 的无凭据示例，未列出账户或 API key 参数；这支持匿名请求的接口形式，但不是无限制使用承诺。该说明明确 `STARTDATETIME`/`ENDDATETIME` 必须在最近三个月内。已查页面未给出固定请求频率或生产使用配额。
- GDELT DOC API 的匿名候选请求返回 HTTP 429（2026-10-11），未取得可用响应；另一 HEAD 请求也返回 429。不能据此确认当前服务格式、可用配额或站点候选，也不能断言是缺少账户所致。无成功响应前不启用生产发现配置。
- `347ff27b` 的枪术种子是 owner API 主动提交数据，PDF URL 不会被当前 HTML worker 抓取；它不能充当真实联网采集 smoke 来源。

## 执行前门槛

1. **代码版本**：把单 owner 门控合入当前主线后重新跑相关测试和 CI；候选部署要按 iFrame release 流程通过。当前本地分支起于 `c35cef2`，比实际生产版本旧，不能直接按旧基线部署。
2. **发现服务**：记录 GDELT 官方访问条款、允许的请求频率、日期窗和一条成功的 `artlist/json` 响应字段；429 时按 `rate_limited` 记录并停止，不靠提高请求频率探测。旧日期需求不用于这次 smoke。
3. **来源站点**：选一篇近 30 天内可由 GDELT 发现、无登录、无 cookie 依赖、HTTPS 且返回 `text/html` 的页面。记录精确主机名、实际重定向主机、robots/服务条款与存储原文及引用短摘的依据。图片不作为这次通过条件。不得用需要认证的页面、PDF 或未知版权的完整转载作为测试来源。
4. **账户与数据**：确定一个专用测试 `owner_profile_id` 和测试会话，使用该账户本人的登录身份；不可在日志或文档写 token。确认数据库/COS 联合备份和恢复流程、测试数据清理方式。试运行仅用该 owner；配置中不得使用 `*`。
5. **配置一致性**：API 与 worker 使用相同的单个 `IFRAME_KNOWLEDGE_CAPTURE_HOSTS` 精确主机名。API 配置 `IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER=gdelt` 与 `IFRAME_KNOWLEDGE_RESEARCH_OWNERS=<测试 owner_profile_id>`。先在隔离候选环境验证功能，再经现有发布流程进入生产。配置值只通过受管环境文件修改，不能写进仓库或命令输出。

## 单次 smoke 顺序

1. 发布前后用 `python3 scripts/iframe_release.py inspect` 记录源码、后端和静态版本；验证 worker 的运行状态和 schema v3。用测试 owner 与另一 owner 读取 `/knowledge/research-capability`，预期分别为 `true`、`false`。另一 owner 直接创建研究应为 403 且数据库无其新任务。
2. 测试 owner 在 Playground 打开知识检索与联网研究，询问一个近 30 天、主体无歧义的公开事件。核对解析的 subject、日期、维度与候选；候选的 `seen_at` 不标为发布日期。选择且仅选择一条已核验主机上的候选。
3. 记录 run ID、job ID、候选 URL、状态转移和失败码。任务 ready 后记录 source ID、revision ID、至少一个 text unit ID 与 locator；通过 owner API 检索回读原文短摘。另一 owner 对 run/source/unit 的读取必须被拒绝。
4. 由原会话生成回答。逐句核对重要事实是否由所引用的原文单元直接支持；只通过 `[unit_id]` 语法检查不算成功。若源文没有支持某句，记为 `unsupported`，保留原回答供评估；不要把模型解释标作来源事实。
5. 核对相同来源再次导入的修订幂等性、任务残留和 worker 错误。记录返回 ID、状态、时间与匿名化错误，不保存原文全文、凭证或页面截图到文档。

## 停止与收尾

- 429、条款不清、目标跳到未核验主机、私网地址、登录墙、非 HTML、超限响应、owner 越权或引用错误时停止本轮；保留失败码，不临时扩大 host 列表。
- 结束前确认没有 queued/running 的试运行任务，再关闭 provider/hosts/owners 配置并按发布流程恢复服务。复核能力接口对两个 owner 都为 false，worker 健康且无异常重启，记录测试集合和 COS 对象的清理或留存决定。
- 通过只证明这一篇来源、一次查询、一个 owner 的真实链路；不证明长期稳定性、财务数字准确性或普遍的回忆真伪判断。
