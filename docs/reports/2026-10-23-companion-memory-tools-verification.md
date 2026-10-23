# 个人陪伴记忆工具接入基础验证

代码事实：新增独立`src/apps/companion_runtime`，未改Playground `agent_api.py`未提交修改，未挂载既有应用或修改隔离测试站。显式初始化独立SQLite数据库，按现有UserContext分owner/actor；严格用户消息API只保存用户文本、不生成模型消息；四工具为memory.save/search/list/delete。模型接入以后使用tools.py的schema/dispatch，确认API不在模型工具清单中。仅有代码和TestClient证据，不能声称真实Agent已执行或网页已可用。

保存提议验证来源用户消息和逐字quote，返回15分钟token及可核对的原话/拟保存内容。按钮确认接口严格校验owner/actor/token和operation_id；事务追加记忆与无正文回执，重复确认幂等。取消关闭预览，不回滚此前确认。删除前读指定记忆供核对，确认后从所有有效读接口消失，清除其他删除预览，回执不留content/quote。原始用户聊天文本另存并继续保留。已删除后重放旧保存回执仅返回历史结果，不恢复记忆。

search实际以query连续文字匹配content或quote，转义LIKE的%/_/反斜杠，可按type/min_importance筛选，再按重要度和ID分页；list稳定ID分页，无最近100条限制。查询cursor绑定owner/query/type/min_importance。无向量、语义匹配或自动记忆注入。用户确认也不证明故事/偏好是客观事实。容量上限为每owner100个有效预览、200会话、10000有效记忆，每会话5000用户消息；上限拒绝不静默丢失。不是全部记忆进入模型窗口的承诺。

验证命令：`.venv/bin/python -m pytest tests/test_companion_runtime.py -q --disable-warnings`，8项行为测试全部通过。真实临时SQLite与FastAPI TestClient覆盖：显式初始化、106条用户消息分页、消息幂等与内容冲突；未确认零记忆、取消、伪造method/owner/tool/source拒绝；107条有效记忆分页、重要度/类型/真实相关性/特殊字符/空查询；owner与actor隔离；15分钟过期清理；100个待确认容量；保存和删除回执失败事务回滚；并发同确认幂等/不同删除预览失效；删除后search/list/get无结果与旧回执不复活。没有外部网络、模型、浏览器或真实麦克风调用。

本片不改照片代码/前端/worker，因此不重跑无关照片构建或部署。已知边界：没有用户会话列表UI、assistant消息/完整Agent请求、模型上下文选择、真实Qwen工具调用、CopilotKit远程运行时、语音/照片工具；没有会话/消息删除（须定义来源撤回），也不迁移旧Playground记忆。API只在测试应用挂载；现有测试站保持上一片369eefbf静态前端、0397e051后端。后续先核对权威Qwen/CopilotKit协议，按接入spec实现真实模型读工具与写提议、按钮确认及四项个人记忆浏览，再逐个接照片问题/版本受限工具。不推送或合并。

## Qwen调用适配与网页确认（后续切片）

已实现个人渠道Qwen OpenAI-compatible单轮函数提议，官方协议核对见接入spec。服务端turn有operation幂等、120秒claim/token，模型调用在事务外；模型schema仅四项memory工具，不含confirm；一次最多一工具，不做第二轮模型总结，工具读结果直接显示。save必须当前用户消息来源，delete要求本轮明确记忆ID，否则用户在列表选择。结果持久化只保存文本或工具引用，查询结果重读实际有效记忆，不复制列表/删除正文进入turn。未自动注入已保存记忆，不声称完成跨会话智能唤醒。

独立网页`/companion/agent`提供文字外发勾选、用户原话分页、最近一轮结果恢复、记忆提议/编辑后重预览/按钮确认/取消、实际list/search及删除。浏览器只存session/turn ID；服务端校验归属。页面目前恢复用户原话及最近一轮助手结果，不是完整assistant对话历史。确认按钮是应用交互门禁，不是声纹/人类证明，沿用用户接受的Demo身份。

验证：191后端（13陪伴+178照片）、81前端（19入口/新聊天+62照片）测试通过，typecheck及隔离静态build通过。新增模型适配wire测试为mock HTTP；不证明UniArt账户实际支持qwen3.8-flash tool_calls。本机Chrome/CDP+真实临时SQLite/FastAPI+合成模型响应全流程passed：未勾选不发送、预览/取消零记忆、明确保存、刷新原话、列出、删除预览不删除、确认删除/空列表及320px、200%字体、横屏布局。无模型请求、真实麦克风或实体设备证据。

部署前端/后端启动wrapper revision fde98d1b 到既有隔离Demo；新增独立`/data/companion.db`显式初始化，API只在该wrapper挂`/companion-agent-api`。源码新目录独立同步；仅重启API，不改照片worker/model/数据。旧wrapper保存在`/srv/lumenx/companion-demo/demo-app-before-agent.py`；回滚恢复该wrapper及旧静态页面，保留companion.db历史不删除。公开health fde98d1b、新页HTTP200。原生产Agent未改动，未推送合并。

测试入口：https://garage.uniart.fun/companion-demo/companion/agent 。有个人UniArt配置的同一身份可主动勾选后发送；新浏览器未配置渠道可能被拒绝，需要按既有创作台配置流程处理。实际付费Qwen调用仍未执行，不宣称真实渠道端到端通过。下一片应验证真实个人渠道tool_calls，补足失败后的可恢复turn/会话查询和预览状态恢复，再评估CopilotKit事件桥与语音/照片工具。

部署后Chrome/CDP合成新owner烟测passed：实际API创建session/用户消息、save提议时memory.list空、实际确认写入；网页列出保存项、删除预览取消后再确认删除、空列表、刷新用户原话。服务端save准备/确认由浏览器脚本直接请求，未伪装为实际模型调用；网页保存确认完整流程由前述本机合成模型回归覆盖。无截图、账户凭据或已有个人记录采集。
