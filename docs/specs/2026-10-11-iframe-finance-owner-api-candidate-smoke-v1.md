# iFrame 金融来源 owner API 候选环境 smoke

日期：2026-10-11。状态：本地一次性 PostgreSQL 演练通过；候选环境未执行。

## 目标与边界

验证一条 SEC 申报元数据样本经现有 owner 知识 API 导入、重复导入、回读、检索和跨 owner 隔离。此项测试不启用 GDELT、采集白名单或 AKShare，不调用模型，也不声称财务数字引用已验证。样本来自 SEC submissions JSON；fixture 保存的是经核对的申报元数据，不是整份 SEC 响应或 10-K 正文。

## 前置条件

1. 使用可丢弃候选环境，确认 API、PostgreSQL 和私有 blob 存储健康；记录部署 commit。此脚本会创建持久集合和来源，现有 owner API 没有删除端点。
2. 准备两个不同 `owner_profile_id` 的测试会话 token，分别注入 `IFRAME_FINANCE_SMOKE_OWNER_A_TOKEN` 和 `IFRAME_FINANCE_SMOKE_OWNER_B_TOKEN`。不要把 token 写入命令参数、日志或文档。
3. 确认候选 API 的 HTTPS origin；不要传生产 URL。脚本拒绝非 HTTPS（本地 loopback 除外）及带路径、查询或凭据的 URL。
4. 审阅固定样本 `tests/fixtures/finance_sec_aapl_2025_10k_source.json`。来源权利状态为 `unknown`，仅用于私有测试集合；不得发布到共享公共库。

## 执行

在候选版本的仓库根目录运行：

```sh
.venv/bin/python scripts/verify_finance_owner_api.py --base-url https://candidate.example.com
```

脚本不抓取外部站点，所有请求均使用指定 candidate API。它创建 owner A 的集合及来源，重复提交相同 fixture，按来源和检索结果回读单元，然后以 owner B 检查来源 404 和检索零命中。它不跟随 HTTP 重定向，输出只包含状态和集合、来源、修订、单元 ID。

## 通过条件

- 输出 `status=passed`，有 `collection_id`、`source_id`、`revision_id`、`unit_id`。
- 重复导入 `repeat_created=false`，revision ID 不变。
- owner A 检索命中的 locator 和元数据与来源回读一致，unit ID 能回到来源单元。
- owner B 读取来源为 404，按该 collection 检索零命中。
- API、数据库与存储没有异常错误，GDELT 与采集白名单仍关闭。

记录执行时间、部署 commit、脚本输出、API/worker 健康状态和是否保留测试数据。候选环境可整体销毁；若候选环境需要保留，先按运维流程确定该集合的清理方法，不要用未审查的 SQL 手工删除。失败时保存匿名化状态码和错误边界，不输出 token。

## 本地验证记录

一次性 PostgreSQL 18 + 本地 blob + FastAPI TestClient 演练通过：来源导入、重复修订、来源回读、检索单元 ID 和跨 owner 隔离均符合上述条件。数据库实例已停止。本地测试使用的是模拟会话身份；候选环境的真实身份服务尚未验证。
