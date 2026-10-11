# iFrame 金融来源 owner API 候选环境 smoke

日期：2026-10-11。状态：本地一次性 PostgreSQL 演练及生产单 owner API smoke 通过；候选环境、生产跨 owner 与自动联网采集未验证。

## 目标与边界

验证一条 SEC 申报元数据样本经现有 owner 知识 API 导入、重复导入、回读、检索和跨 owner 隔离。此项测试不启用 GDELT、采集白名单或 AKShare，不调用模型，也不声称财务数字引用已验证。样本来自 SEC submissions JSON；fixture 保存的是经核对的申报元数据，不是整份 SEC 响应或 10-K 正文。

## 前置条件

1. 使用可丢弃候选环境，确认 API、PostgreSQL 和私有 blob 存储健康；记录部署 commit。此脚本会创建持久集合和来源，现有 owner API 没有删除端点。
2. 准备测试 owner 的会话 token，注入 `IFRAME_FINANCE_SMOKE_OWNER_A_TOKEN`。完整隔离检查还需要另一个 `owner_profile_id` 的 token，注入 `IFRAME_FINANCE_SMOKE_OWNER_B_TOKEN`。只有一个身份时显式使用 `--single-owner`；跨 owner 隔离保持待验证。不要把 token 写入命令参数、日志或文档。
3. 确认候选 API 的 HTTPS origin；不要传生产 URL。脚本拒绝非 HTTPS（本地 loopback 除外）及带路径、查询或凭据的 URL。
4. 审阅固定样本 `tests/fixtures/finance_sec_aapl_2025_10k_source.json`。来源权利状态为 `unknown`，仅用于私有测试集合；不得发布到共享公共库。

## 执行

在候选版本的仓库根目录运行：

```sh
.venv/bin/python scripts/verify_finance_owner_api.py --base-url https://candidate.example.com
```

单 owner 模式：

```sh
.venv/bin/python scripts/verify_finance_owner_api.py --base-url http://127.0.0.1:17178 --single-owner
```

主机上只有 API key 文件时，可在主机本地通过 loopback 换取短期 owner 会话。脚本校验密钥指纹与返回的 owner 一致，不输出密钥或会话 token：

```sh
python3 scripts/verify_finance_owner_api.py --base-url http://127.0.0.1:17177 --api-key-file /opt/.iframe --single-owner
```

对生产端口运行会持久写入生产 PostgreSQL/COS；仅在该密钥对应的测试 owner 已确认、允许保留测试集合时执行。

脚本不抓取外部站点，所有请求均使用指定 candidate API。它创建 owner A 的集合及来源，重复提交相同 fixture，按来源和检索结果回读单元。双 owner 模式另外检查来源 404 和检索零命中；单 owner 模式输出 `cross_owner=pending`。它不跟随 HTTP 重定向，输出只包含状态和集合、来源、修订、单元 ID 及检查状态。

## 通过条件

- 输出 `status=passed`，有 `collection_id`、`source_id`、`revision_id`、`unit_id`。
- 重复导入 `repeat_created=false`，revision ID 不变。
- owner A 检索命中的 locator 和元数据与来源回读一致，unit ID 能回到来源单元。
- 双 owner 模式下，owner B 读取来源为 404，按该 collection 检索零命中；单 owner 模式不声称隔离已验证。
- API、数据库与存储没有异常错误，GDELT 与采集白名单仍关闭。

记录执行时间、部署 commit、脚本输出、API/worker 健康状态和是否保留测试数据。候选环境可整体销毁；若候选环境需要保留，先按运维流程确定该集合的清理方法，不要用未审查的 SQL 手工删除。失败时保存匿名化状态码和错误边界，不输出 token。

## 本地验证记录

一次性 PostgreSQL 18 + 本地 blob + FastAPI TestClient 演练通过：来源导入、重复修订、来源回读、检索单元 ID 和跨 owner 隔离均符合上述条件。数据库实例已停止。本地测试使用的是模拟会话身份；候选环境的真实身份服务尚未验证。

2026-10-11 主机只读预检：SSH 可达，当前源码 revision 为 `021277d84275b7cd4568b03cebb91c6a08403851`，生产 `/health` 返回 `ok=true`，知识路由存在；`17178` 候选 API 未运行。已确认服务商密钥环境变量名称，但尚未确认可用于测试的 owner 身份 token 路径和归属。未请求生产 API 写入，也未启用发现或采集白名单。单 owner 脚本的三项本地行为测试通过，跨 owner 测试仍需第二个身份在真实环境重测。

## 生产单 owner 验证记录

2026-10-12 00:01 HKT，在部署 revision `021277d84275b7cd4568b03cebb91c6a08403851` 的 iFrame 主机执行。主机 `/opt/.iframe` 是单行 API key 文件；通过本机 `/auth/session-token` 换取 900 秒会话，验证返回 `auth_mode=api_key_session`、owner 与该 key 的 SHA-256 指纹一致；写入前该 owner 可见集合数为 0。未输出或记录 key、会话 token 及完整 owner ID。

固定 SEC fixture 通过生产 loopback `127.0.0.1:17177` 的普通 owner 知识 API 导入并回读，脚本返回 `status=passed`、`repeat_created=false`、`cross_owner=pending`。持久记录：collection `f4a8fbed-f3da-49f1-b060-5d44dd535967`、source `6bdb0047-cb3d-470f-9098-6b2715e5c4b3`、revision `a0c91b17-0734-4e6e-bd62-1274e8fe06a3`、unit `c79e4b35-1cfb-4922-a9bc-6ca0df35ad3e`。测试数据保留在该私有 owner 的生产 PostgreSQL/COS；当前 API 无删除端点。

完成后 `/health` 仍为 `ok=true`，后端与独立 worker 均运行且重启计数为 0；两者的发现 provider 与采集 host 列表均未启用。这验证了固定金融来源元数据经 owner API 的导入、幂等、检索和引用单元定位；没有验证 SEC 自动发现、网页采集、模型生成、财务数字正确性或生产跨 owner 隔离。`/opt/.iframe` 当前权限为 `0644`，应由主机管理员评估收紧为仅授权运行账号可读，避免其他本机用户读取 API key。
