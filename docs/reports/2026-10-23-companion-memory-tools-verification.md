# 个人陪伴记忆工具接入基础验证

代码事实：新增独立`src/apps/companion_runtime`，未改Playground `agent_api.py`未提交修改，未挂载既有应用或修改隔离测试站。显式初始化独立SQLite数据库，按现有UserContext分owner/actor；严格用户消息API只保存用户文本、不生成模型消息；四工具为memory.save/search/list/delete。模型接入以后使用tools.py的schema/dispatch，确认API不在模型工具清单中。仅有代码和TestClient证据，不能声称真实Agent已执行或网页已可用。

保存提议验证来源用户消息和逐字quote，返回15分钟token及可核对的原话/拟保存内容。按钮确认接口严格校验owner/actor/token和operation_id；事务追加记忆与无正文回执，重复确认幂等。取消关闭预览，不回滚此前确认。删除前读指定记忆供核对，确认后从所有有效读接口消失，清除其他删除预览，回执不留content/quote。原始用户聊天文本另存并继续保留。已删除后重放旧保存回执仅返回历史结果，不恢复记忆。

search实际以query连续文字匹配content或quote，转义LIKE的%/_/反斜杠，可按type/min_importance筛选，再按重要度和ID分页；list稳定ID分页，无最近100条限制。查询cursor绑定owner/query/type/min_importance。无向量、语义匹配或自动记忆注入。用户确认也不证明故事/偏好是客观事实。容量上限为每owner100个有效预览、200会话、10000有效记忆，每会话5000用户消息；上限拒绝不静默丢失。不是全部记忆进入模型窗口的承诺。

验证命令：`.venv/bin/python -m pytest tests/test_companion_runtime.py -q --disable-warnings`，8项行为测试全部通过。真实临时SQLite与FastAPI TestClient覆盖：显式初始化、106条用户消息分页、消息幂等与内容冲突；未确认零记忆、取消、伪造method/owner/tool/source拒绝；107条有效记忆分页、重要度/类型/真实相关性/特殊字符/空查询；owner与actor隔离；15分钟过期清理；100个待确认容量；保存和删除回执失败事务回滚；并发同确认幂等/不同删除预览失效；删除后search/list/get无结果与旧回执不复活。没有外部网络、模型、浏览器或真实麦克风调用。

本片不改照片代码/前端/worker，因此不重跑无关照片构建或部署。已知边界：没有用户会话列表UI、assistant消息/完整Agent请求、模型上下文选择、真实Qwen工具调用、CopilotKit远程运行时、语音/照片工具；没有会话/消息删除（须定义来源撤回），也不迁移旧Playground记忆。API只在测试应用挂载；现有测试站保持上一片369eefbf静态前端、0397e051后端。后续先核对权威Qwen/CopilotKit协议，按接入spec实现真实模型读工具与写提议、按钮确认及四项个人记忆浏览，再逐个接照片问题/版本受限工具。不推送或合并。
