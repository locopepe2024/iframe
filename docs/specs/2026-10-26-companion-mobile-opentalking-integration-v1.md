# Companion 移动端 OpenTalking 集成 v1

## 定位

当前 demo 是内部验证环境，不把它设计成公网多租户产品。移动端仍以 Companion 为主界面；OpenTalking 作为聊天页内的语音/角色表现层集成，不单独暴露一套用户入口。

## 最小交互

- 底部功能仍是“聊天 / 相册 / 日记 / 我的”。
- 用户进入“聊天”后，默认显示现有文字聊天流。
- 点击大号语音按钮时，打开 OpenTalking 媒体面板；面板只负责角色画面、听说状态、打断和结束。
- 文字消息、记忆查询、知识查询、日记和相册继续由 iframe Companion 服务负责。
- OpenTalking 返回的识别文字和助手文字回填当前聊天流，避免形成第二套历史记录。
- 退出聊天或切换功能时，先关闭 WebRTC，再释放 context token。

## 数据流

```text
移动端 Companion
  ├─ 文字/日记/相册 → iframe Companion API
  └─ 语音按钮
       → 创建短期 OpenTalking session
       → iframe 只读记忆/知识 gateway
       → OpenTalking WebRTC + TTS/角色画面
       → transcript / assistant text 回填 Companion 聊天流
```

当前 demo 可以直接使用浏览器工作区身份；正式产品再切换注册用户身份。OpenTalking 前端不保存 iframe Bearer，也不成为记忆和日记的第二数据源。

## 实现边界

第一阶段只做移动网页，不改原生 App，不接 GPU 新模型，不重新设计 Companion 卡片。OpenTalking 面板使用现有 CPU Mock 的 session、WebRTC、打断和销毁能力；未配置 OpenTalking 时，聊天仍退回文字和现有语音输入。

## 验收

1. 移动浏览器打开聊天页，文字聊天行为不变。
2. 点击语音按钮可以打开角色画面并完成合成语音播放。
3. 说话后的 transcript 和回复文字出现在同一个 Companion 聊天流。
4. 点击停止、返回或切换相册时，旧音频停止，WebRTC session 被销毁。
5. 记忆/知识查询只发生在 iframe gateway；刷新或重新进入不会生成第二份历史。
6. OpenTalking 不可用时，页面显示可理解的文字聊天状态，不出现永久加载。

## 2026-10-27 无声修复边界

运行观察：创建参数缺 avatar_id / 错 model 曾返回 400；修正后 session 创建 200，`/speak` 返回 queued 不证明有音频。代码事实：knowledge_enabled 默认 true 会重新打开 agent；即便全部关闭，synthesis_runner.speak 的 feeder 仍无条件调用 llm.chat_stream，agent_enabled 仅控制上下文。这推翻此前“设置 false 即跳过 LLM”的结论。另一个确定的生命周期缺陷是 history 刷新会移除 live-turn 组件并销毁 WebRTC。

本切片：服务端 SpeakRequest 显式增加 render_text，含入幂等 payload hash，经任务队列传入 CPU Mock synthesis_runner，仅该模式的 feeder 直接送原文字到 TTS，不查询记忆/知识、不调用 LLM、不加固定开场白，旧 speak 模式保持。测试需用禁止调用的 LLM fake 和真实非静音 WebRTC 解码验证；不以 queued/track 事件替代音频证据。

前端只挂载一个聊天页级 OpenTalking 会话，跨 history 刷新与多轮回复保持；明确 reply turn_id 防重，失败只保留文字与显式重试，不回退另一家 TTS。先 start 等 ready、协商并等 peer connected，再 speak；SSE 错误与 speech.ended 关联本轮 command id；音频 RMS 用于接收状态，不宣称扬声器发声。autoplay 失败保留可操作播放按钮。主动打断/文字模式/新会话/离开销毁媒体和会话，迟到 session 创建也删除。复用原播放互斥，避免把数字人音频再次转写。普通聊天与语音入口只使用这一 Agent 事实源；人设不得捏造已听见、已播出或声称产品完全不支持语音。
