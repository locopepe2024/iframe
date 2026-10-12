# iFrame 联网研究单 owner 试运行门控

日期：2026-10-11。状态：本地实现并验证，尚未合并或部署。用于生产真实来源 smoke 前的服务端边界。

## Observed

- `GET /knowledge/research-capability` 当前只根据全局 discovery provider 与 capture hosts 报告可用。`POST /knowledge/research`、Agent `live_research` 路径及选源 API 没有试运行 owner 门控。
- 因此一旦生产配置全局 provider 和主机白名单，任意已登录 owner 可直接创建研究任务；前端开关不能构成单用户试运行限制。
- worker 按数据库中的队列执行，采集主机策略由它自己的环境配置决定。

## 目标和边界

新增 `IFRAME_KNOWLEDGE_RESEARCH_OWNERS`，逗号分隔精确 `owner_profile_id`。provider、capture hosts 和 owner 列表三者都有值，且当前 owner 在列表内，才允许新研究与选源。空列表关闭所有 owner；不支持通配符。只读状态查询仍可访问 owner 自己已经创建的任务；普通知识库导入、检索不受影响。

Agent 在调用规划模型之前检查门控，避免被拒绝的请求仍产生模型费用。API 在写入任务之前再次检查门控；直接调用 API 不能绕过。已入队任务由 worker 按原有 lease 流程完成；关闭配置之前先检查队列归零。部署时 API 和 worker 必须持有相同的精确 capture hosts。

## 成功标准

1. 无 provider、无 hosts、无 owners 或 owner 不匹配时，能力接口返回 `enabled=false`；研究创建和选源返回 403，且不写数据库、不调用发现服务。
2. 单 owner 配置时只有被列入的 owner 可创建、选源；另一 owner 即使直接调用 API 也被拒绝。
3. 普通知识导入与检索继续走原有 owner 身份权限。
4. 运行 `tests/test_knowledge_research.py`、受影响的 Agent 测试和前端能力测试；在一次性数据库上复测 API/worker 交接。生产只读复核配置仍为空。

受影响路径：`src/apps/knowledge/api.py`、`src/apps/agent_api.py`、`tests/test_knowledge_research.py`、`tests/test_agent_chat.py`、验证计划。不得在本次改动中开启生产配置、扩展白名单或采集真实页面。

## 验证记录

- `tests/test_knowledge_research.py tests/test_agent_chat.py`：54 通过；包含未列入 owner 在规划前被拒、直接 API 403 且无存储/发现调用。
- 一次性 PostgreSQL 18：`tests/test_knowledge_research_postgres.py` 2 通过；API 建立任务、独立 worker 消费固定夹具、原文回读和跨 owner 拒绝。实例已关闭。
- 尚未验证实际生产环境变量切换、GDELT 成功响应、真实 HTTPS 采集或 COS 写入。
