# iFrame Federal Reserve RSS 候选发现 smoke

日期：2026-10-12。状态：候选代码与本地验证完成；生产配置保持关闭。

## Observed

- 生产容器内 GDELT 单次查询返回 HTTP 429，无 `Retry-After`。当前唯一发现 adapter 是 GDELT；线上版本还没有单 owner 门控，不能直接开放研究入口。
- SEC 2025 Apple 10-K HTML 用现有 worker 的 User-Agent 返回 HTTP 403；SEC submissions JSON 虽可达，现有 worker 只接受 HTML。
- 美联储官方 `https://www.federalreserve.gov/feeds/press_all.xml` 返回 HTTP 200。2026-10-09 的 RSS 条目指向 `https://www.federalreserve.gov/newsevents/pressreleases/other20261009a.htm`，主题为 2025 Survey of Consumer Finances。现有 worker 对该 HTML 的单次抓取返回 200、86,767 字节，并解析出 42 个文本块。`robots.txt` 本次返回 404，因此不能据此作出 robots 允许的结论。

## 目标与边界

增加仅用于官方新闻的 `fed_rss` 发现 provider：一次请求固定 RSS 地址，按标题与查询词及日期范围筛选，最多返回 10 条候选。只接受 `www.federalreserve.gov` 的 HTTPS `/newsevents/pressreleases/` 页面；不支持任意 feed URL、站外跳转、SEC JSON、AKShare 或金融数字 adapter。RSS 候选不是证据；只有用户选中、worker 入库后的原文单元可被引用。

候选记录分开保存 Feed 的 `pubDate` 和发现时间。一次响应上限 256 KiB；不跟随 Feed 重定向；全局预算每 60 秒一次、每天最多 20 次，owner 每天最多 20 次。该预算是 iFrame 自设测试保护，不代表来源方公布配额。来源内容只保存在测试 owner 的私有库，权利状态仍为 `unknown`。正式持续使用前需要管理员复核来源使用条款、数据留存及版权边界。

## 成功条件

1. 未配置 provider/hosts/owners、非测试 owner、未知 provider 均不能创建研究或选源。
2. 固定 RSS fixture 的标题、发布时间、URL 和查询/日期过滤正确；站外 URL、非 HTTPS、错误路径、超大或无效 XML 被拒绝或忽略；429 与请求失败可观察。
3. 本地测试与 CI 通过；候选环境 API 与 worker 使用同一个精确主机白名单，只给测试 owner 开启 `fed_rss`。
4. 候选环境中一次真实 Feed 发现、选择单条来源、worker 原文入库、检索单元及带引用回答经人工核对。完成后关闭所有试运行门控；生产部署另走正式发布流程。

## 受影响路径与验证

- `src/apps/knowledge/discovery.py`：有界 RSS 获取和候选解析。
- `src/apps/knowledge/api.py`：允许 `fed_rss` 进入已存在的单 owner 门控，并对所有 provider 扣预算。
- `src/apps/knowledge/store.py`：按 provider 分隔预算；GDELT 现有预算保持原值。
- `tests/test_knowledge_research.py`：Feed 解析、失败状态、门控和预算行为。
- 运行 `python3 -m pytest tests/test_knowledge_research.py tests/test_knowledge_research_postgres.py tests/test_agent_chat.py -q`；候选部署后按运行单执行一次低频外部 smoke。

## 未证明

RSS 的 HTTP 200 与单篇 HTML 可抓取不证明长期可用或来源许可。解析文本块包含页面导航内容，人工引用核验仍是通过条件。GDELT、SEC HTML 和 AKShare 的阻断不会因为此 adapter 通过而解除。

## 当前验证记录

- 主机上用候选适配器实际读取官方 Feed，查询 `Survey of Consumer Finances`、日期 2026-10-01 至 2026-10-12，返回唯一候选 `other20261009a.htm`，`access_status=public`，发布时间 `2026-10-09T14:00:00+00:00`。
- `tests/test_knowledge_research.py tests/test_agent_chat.py` 本地 57 通过；一次性 PostgreSQL 18 上 `tests/test_knowledge_research_postgres.py` 3 通过，包含 provider 独立预算、API 创建选源、独立 worker 入库和 owner 隔离；临时数据库已关闭。此次 worker 集成测试使用固定 HTML，不代表真实生产 COS 或模型回答通过。
- 线上版本 `021277d84275b7cd4568b03cebb91c6a08403851` 尚无单 owner 门控；候选代码基于 PR #85，不应直接替换生产后端。候选 API 与 worker 将用独立进程、隔离 Studio 输出目录和测试 owner 配置运行；正式生产切换仍须合并代码与发布审核。
