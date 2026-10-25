# OpenTalking → iframe 只读上下文适配 v1

目标：通过 iframe 现有 HTTP API 读取当前用户的记忆与知识，供一次 LLM 回复使用；不复制数据库，不启用 OpenTalking 自有记忆写入，不增加第二次 LLM 调用。

代码事实：Companion `POST /companion-runtime/tools` 支持 memory.search；knowledge `POST /knowledge/search` 返回有可见范围控制的内容单元。当前分别是 SQL LIKE / ILIKE 文本匹配，不声称向量语义检索。

边界：适配器由可信服务端传入明确的身份 headers，禁止隐式全局 owner、禁止从聊天文字或 OpenTalking user_id 推导权限。两种 API 可配置不同根路径，以适配 demo 的 Companion 和生产知识服务部署。身份映射尚未打通，不能把公开 Mock 所有访客映射为 demo 机主。第一阶段不自动上线私密数据查询。

契约：并发读取记忆和知识，独立短超时；只返回限量正文及来源 ID，不返回图片/视频 URL、原话 quote、actor/owner、秘密 headers。任一服务不可用则显式报查询失败，由调用层显示状态，不伪称没有记忆。不改写用户原话。检索片段作为不可信参考资料，不能作为系统指令执行；LLM仍需防提示注入评估。

验证：MockTransport 检查身份传递、两路检索、字段裁剪、来源、长度限制、鉴权失败及异常格式。成功标准是适配器可被服务端调用且只读，不能将单元测试声称为测试站已接入私人知识库。

下一切片：iframe 身份绑定/短期会话凭据 → OpenTalking 会话按绑定调用适配器 → 当前回复注入只读片段 → 远端一次 LLM → 现有 TTS/UDP WebRTC。身份绑定必须与连接生命周期一起清理；保持 CPU Mock。公开测试站在该边界完成前不启用真实用户数据。

## 本轮实现与验证

新增 `src/apps/companion_runtime/opentalking_context.py`：IframeContextReader 并发调用现有只读API；messages_for_turn 只准备本轮消息副本；IframeGroundedLLM 实现上游相同的 async chat_stream 接口，在既有一次LLM请求前加入带来源片段。构造时必须显式绑定身份。超过100字的用户输入仅取前100字用于当前文本检索，不宣称完整语义召回。

新增11项适配器测试，连同8项既有记忆运行时测试共19项通过。覆盖两路身份传递、只读请求、字段裁剪、来源、空结果与失败区分、鉴权失败、错误格式、超时、单次LLM调用、原始历史不被修改。没有把MockTransport测试等同于线上跨服务验收。

当前公开OpenTalking仍未实例化此适配器，真实个人数据未接入；没有改变正在验证的CPU语音/UDP播放服务。身份映射与会话入口整合尚待实现，之后才能声称“测试站已打通”。

## 身份绑定模块切片

新增 `opentalking_binding.py` 的单进程 SessionBindings（符合当前 unified 单worker边界）。可信接入服务先验证 bearer，再调用bind，不能把bind直接暴露为匿名路由。绑定owner/actor/会话/随机代次/最多1小时有效期；有容量限制、过期清理、同会话禁止重新绑定、按用户撤销、按身份释放。身份凭据不进入repr、模型消息或日志。

BoundLLM每轮先调用 iframe `/auth/me`，核对owner与actor，再检索；检索完成、提交一次LLM前再次复核绑定，流式输出每段复核。仅本地注册对象不提供HTTP鉴权，因此不能声称公开OpenTalking的session动作已经被隔离；HTTP入口、退出事件对接与凭据签发仍需下一切片落实。

验证：适配器11项、绑定8项、既有记忆8项、知识API4项，共31项通过。包含真实Companion HTTP路由+临时SQLite的双用户记忆隔离测试；该项知识结果是空fixture，未运行生产PostgreSQL检索；未调用远端LLM。测试覆盖跨用户释放、超时、重复绑定、退出撤销、每轮身份校验失败、流中撤销、检索期间撤销后不调用LLM。

当前无远端部署变更。下一项明确未完成工作：在iframe页面签发会话绑定，代理OpenTalking会话动作并验证同一绑定，选择正确的Companion/知识服务地址，接入runner.llm并在关闭时清理；之后才做浏览器+远端LLM只读检索验收。现有demo浏览器工作区仍可继续使用，但不能把浏览器标识本身升级为这里要求的已验证bearer。
