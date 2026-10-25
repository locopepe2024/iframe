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
