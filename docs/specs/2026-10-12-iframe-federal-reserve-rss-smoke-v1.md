# iFrame Federal Reserve RSS 候选发现 smoke

日期：2026-10-12。状态：候选真实发现、采集、原文回读与检索通过；同一已入库研究任务的回答处理逻辑及隔离 HTTP 路由均生成带有效单元 ID 的回答。生产服务中的连续同会话全链路和引用语义尚未验证；生产联网门控保持关闭。

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
- 线上版本 `021277d84275b7cd4568b03cebb91c6a08403851` 尚无单 owner 门控；候选代码基于 PR #85，不应直接替换生产后端。候选 API 与 worker 用独立进程、隔离 Studio 输出目录和测试 owner 配置运行；正式生产切换仍须合并代码与发布审核。

## 候选环境真实链路记录

候选 API 在主机回环 `127.0.0.1:17178` 运行，初始源码为 `e9ebae9b94b1a0ba97b77fd52346b82e02c37a3b`；使用隔离 Studio 输出目录、现有受管数据库/COS 凭据、`fed_rss`、单个 capture host `www.federalreserve.gov` 和 `/opt/.iframe` 对应的唯一测试 owner。未切换生产 API 或静态页面。生产 worker 队列为空后暂停，候选 worker 完成一条任务后生产 worker 已恢复。

- 测试 owner 的能力接口为 true；另一 owner 为 false，直接创建研究返回 403。
- 真实 Feed 发现产生 run `444b1973-c8af-490c-a8c5-80b6fe5c17b7`，唯一候选为 `other20261009a.htm`。选中后 job `75a8e44f-55a7-44b5-b2cc-268362b4fa6e` 从 queued 到 ready，来源 `e6f7b790-bb80-4c7c-a42d-e177dc6e81f7` 有 42 个文本单元；相关正文见 `block:28`。另一 owner 读取来源返回 404。
- 原始 HTML 经私有 COS 回读为 86,767 字节，SHA-256 与数据库修订一致；测试集合、来源及原文保留在该测试 owner 的生产 PostgreSQL/COS。未调用模型，也未验证回答语义。
- 检索复核发现真实缺陷：来源标题含整句查询时，默认 `limit=10` 先返回页面导航块，相关正文 `block:28` 被挤出结果。一次性 PostgreSQL 测试先复现失败，再把正文命中排在标题命中前。候选 API 更新至 `8664d93e61e666966a406d910bd74d24b0d65808` 后，对相同真实来源的默认搜索返回 `block:28` 与 unit `8821b97e-80b9-4587-826f-57329bf9dab1`；另一 owner 在该集合搜索为零命中。
- 停止旧 worker 时 `docker stop --time 30` 超时并以 137 退出；生产 worker 后续已恢复且队列无活动任务。候选代码加入 SIGTERM/SIGINT 退出处理后，空队列候选 worker 在 5 秒 Docker 超时内以退出码 0 停止。
- 候选环境测试时，测试 owner 的 `/agent/models` 返回 409 `UniArt API key is not configured for this user`；当时未生成模型回答，也未验证引用语义。
- 后续在生产 API 上按既有配置流程为该测试 owner 保存有效的 UniArt 用户凭据；`/agent/models` 返回 200，包含 5 个 Chat 模型。未修改路由、共享凭据门控或生产联网白名单。凭据本身及其格式未写入本记录。
- 该 owner 用 `qwen3.8-flash` 提交一次短知识库请求，iFrame 返回 200、非空回答及 5 条带 `unit_id` 的知识引用；临时 Agent 会话已删除。此检查证明模型调用与已入库知识检索可衔接，尚未人工审阅回答文字及每条引用的语义准确性，也没有重跑生产联网发现和采集。
- 为补齐候选链路的最后一段，在生产运行容器内使用独立临时 Agent SQLite 会话库，恢复上述 `ready` 研究任务原本绑定的会话 ID，并直接调用现有 `answer_research` 处理逻辑。该任务返回 20 个已采集证据单元；`qwen3.8-flash` 生成非空回答和 20 条引用，所有引用的 `unit_id` 均属于该任务证据集合。临时库已删除；生产知识记录、Agent 会话库及联网门控未改动。此结果验证真实发现与采集产物可进入引用回答逻辑，尚未验证同一生产 HTTP 会话连续执行全流程，也未人工核对引用语义。
- 同一运行镜像的隔离 FastAPI `TestClient` 进程再次恢复该测试会话，实际 `POST /agent/sessions/{sid}/research/{run_id}/answer` 返回 HTTP 200、非空回答和 20 条引用；所有引用 ID 均来自该任务的已采集证据。进程与临时 SQLite 库已结束和清理。此检查覆盖回答路由与身份解析，但不是生产 API 进程中连续完成“发现→选源→采集→回答”的单次会话测试。
- 候选 API/worker 容器均已关闭并删除；临时源码、脚本和隔离 Studio 输出副本已清理。生产发现 provider、capture hosts 和研究 owner 配置均未启用；测试 owner 的 run/source/raw 记录保留在生产 PostgreSQL/COS，未尝试手工删除。
