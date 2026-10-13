# iFrame 联网研究开放测试

日期：2026-10-12。

## Observed

线上 API、静态资源和独立 worker 同为 `af73c1d1`。发现服务为 `fed_rss`，采集主机精确限定为 `www.federalreserve.gov`。当前代码还按 `IFRAME_KNOWLEDGE_RESEARCH_OWNERS` 的精确身份列表限制联网研究，因此其他浏览器身份看不到入口。

## 决定与边界

移除研究入口的 owner 白名单判断。已有身份解析仍为每个请求提供非空 `owner_profile_id`，研究任务、来源、会话和引用继续以此隔离。联网入口是否可用只取决于已配置的受支持 discovery provider 和非空采集主机列表。关闭 provider 或清空 hosts 即可关闭入口。

本轮线上测试沿用 `fed_rss` 与精确主机 `www.federalreserve.gov`。发现预算仍有全局与每 owner 上限；采集依旧执行 HTTPS、精确主机、公开 IP、内容类型和大小检查。受管 `.env` 中的旧 owner 列表在发布时删除，API 与 worker 使用同一配置文件。

## 成功标准

1. provider 与 hosts 均已配置时，不同浏览器和 API key 身份的能力接口都返回 `enabled=true`；空身份不开放。
2. provider 或 hosts 缺失时，创建研究和选源在存储或发现前被拒绝。
3. 原有数据的 owner 隔离及发现预算测试通过；API/worker 镜像和精确主机配置一致。
4. 部署后健康检查通过，浏览器身份能读取开放的能力接口。

## Not yet proven

入口开放本身不证明真实用户会话里的发现、采集和引用回答全链路成功；需要实际完成一次任务并核对原文引用。
