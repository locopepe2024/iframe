# 小安主机编排：GitHub 项目调研

调研日期：2026-10-29。读取公开仓库 README 和下列源码；未安装、未运行候选框架。README 中的能力属于项目声明，源码观察与本产品适用性判断分开记录。未访问登录页或用户私有数据。

## 已核对的项目

| 项目 | 已读证据 | 与小安的关系 |
|---|---|---|
| [Pipecat](https://github.com/pipecat-ai/pipecat) / Flows | README；`src/pipecat/flows/manager.py` | 语音管线、状态节点、按节点注册工具、上下文更新及动作执行；最值得深入研究的对话编排参考 |
| [LiveKit Agents](https://github.com/livekit/agents) | README | 声明支持 AgentSession、STT/LLM/TTS 组合、语义轮次检测、客户端 RPC 和测试；适合参考媒体与业务会话的边界 |
| [Qwen-Agent](https://github.com/QwenLM/Qwen-Agent) | README；`qwen_agent/agents/fncall_agent.py` | Qwen 工具注册、模型调用、工具结果回填的有界循环；适合研究模型工具格式适配 |
| [LangGraph](https://github.com/langchain-ai/langgraph) | README | 声明支持状态编排、持久执行、人工介入与恢复；适合相册/日记长任务，非媒体传输方案 |
| [TEN Framework](https://github.com/TEN-framework/ten-framework) | README | 实时多模态会话框架及 VAD、轮次检测生态；适合音频事件参考，未验证与现有 OpenTalking 的兼容性 |
| [CopilotKit](https://github.com/CopilotKit/CopilotKit) | README | 共享状态、工具渲染、生成式 UI、人工介入；适合 React 卡片和 Agent 状态同步，不能替代业务执行器 |

重要版本事实：[独立 pipecat-flows 仓库](https://github.com/pipecat-ai/pipecat-flows) 当前 README 表示已弃用，并自 pipecat-ai 1.5.0 起合入核心 `pipecat.flows`。若做验证，应核对并固定实际依赖版本，不能照旧教程直接安装独立包。

## 两项源码观察

### Pipecat Flows

[FlowManager 源码](https://github.com/pipecat-ai/pipecat/blob/main/src/pipecat/flows/manager.py)具有当前节点、内部状态、节点函数集合、全局函数和上下文策略。上下文和工具更新通过帧送入管线；源码明确将这些更新帧设为不可打断，防止用户打断后模型仍用旧节点上下文/工具。

直接启示：任务切换时，焦点、上下文与可用工具必须作为一致的更新交付给模型。停止语音播放不应中断业务状态同步。内部 `_state` 字典的存在不能证明进程重启后的持久恢复，本次未验证持久化实现。

### Qwen-Agent

[FnCallAgent 源码](https://github.com/QwenLM/Qwen-Agent/blob/main/qwen_agent/agents/fncall_agent.py)在 `MAX_LLM_CALL_PER_RUN` 限制下调用模型、检测工具、执行工具，再将 FUNCTION 结果加入消息。README 同时展示自建兼容模型服务及 native API tool call 配置。

直接启示：工具结果应成为后续决策的正式上下文，而不只是在前端显示。模型格式模板与上游原生工具解析应明确由谁负责，避免混用。该源码不证明其自带我们的任务版本、幂等、确认与持久恢复机制，更不证明 0.5B 模型足以稳定编排。

## 建议架构（待验证）

主机 Qwen 作为语义协调器，选择普通聊天、日记、相册、图片编辑等能力。云端 LLM 是可调用的复杂理解/写作/分析能力；不与主机模型分别维护独立业务语境。确定性运行时校验计划、执行原子工具、存储任务状态及回执；前端卡片和 OpenTalking 消费同一结果。

语音属于交互编排，但麦克风采集、VAD、播放队列及立即打断由程序控制。区分停止发声、暂停业务任务、取消任务、断开连接四种事件，不能用一个“打断”把它们混在一起。

优先深入 Pipecat Flows 的节点/上下文一致性、Qwen-Agent 的工具协议，以及 LangGraph 的等待恢复。CopilotKit 作为 UI 接口候选单独评估。现阶段不同时引入多套框架，不替换已能工作的 OpenTalking 传输，也不把 README 的框架能力当作已验证的产品收益。

## 下一步对照实验

在当前工具服务前加隔离编排适配层，固定同一批合成多轮语料，对比：当前主机 Qwen + 原子工具、候选编排方案、云端 Qwen 参考结果。先核对主机实际模型名称、量化版本、服务约束，再选适配器，不默认支持 native tool calling。

统计动作与参数正确率、上下文切换错误、澄清质量、端到端延迟、内存和 CPU。行为用例必须包括缺图先存要求、语音打断后继续、上传完成事件恢复、日记中提及照片、跨任务改口、并发版本冲突、失败重试及重启恢复。不得用框架启动成功代替这些验收。

当前尚未选定依赖、验证本机小模型性能或修改运行时；结论是参考优先级，而非迁移批准或兼容性证明。
