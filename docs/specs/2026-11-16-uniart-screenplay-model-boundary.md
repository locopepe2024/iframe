# UniArt 剧本模型选择边界修复

## 已核实

生产 8415ca03 的总纲请求在 2026-11-16 10:25:33 UTC 记录 `gateway=uniart model=llm-nf-all`，发往 `https://uniart.fun/v1/chat/completions`。UniArt 返回 404 `model_not_found` / `model ... is not published for user access`。适配器根据进程 `LLM_PROVIDER=openai` 将错误标为 OpenAI，名称不能证明请求去了 OpenAI 官方服务。

当日只读 GET `https://uniart.fun/api/pricing` 发布 DeepSeek v4.1 Flash 与 Kimi K3，没有 llm-nf-all；UniArt middleware/distributor.go 的可见性检查对未发布模型返回该 404。此证据证明目录发布状态，不证明所有账户均有权限或实际生成成功。

## 修改范围

- 剧本模型继续使用现有 UniArt OpenAI 兼容 transport 和账户凭据，禁止为避开 404 改走 GreenA、共享密钥或其他模型。
- 模型设置返回按已配置网关区分的选项：UniArt 不提供 llm-nf-all；GreenA 保持现有三项。未设置偏好时 UniArt 默认 DeepSeek v4.1 Flash，已有偏好保持可见，不静默替换。
- 不允许向 UniArt 保存/提交 llm-nf-all，明确提示去模型设置选择已发布模型。文档读取、保存和已完成任务查询不能因旧偏好而失效。
- 前端使用后端选项；保留旧的不适用偏好作为禁用项，引导手动选择。
- 错误及日志标注实际 gateway，保留状态码与诊断；404 不自动换模型重试。
- 不改总纲分段算法、缓存目录/键、原稿、既有解析结果或采用流程。切换模型后按现有模型隔离规则建立独立缓存，不混用旧模型结果。

## 验收

先用失败测试覆盖 UniArt 选项与非法模型拒绝、准确错误来源及不自动重试；修复后验证两种网关、异步模型快照、账户隔离和总纲 checkpoint 回归。用户选定模型后核对其账户目录；真实总纲重试需保持原任务范围，不能自动采用模型结果。真实模型可用性与写作质量分别记录。
