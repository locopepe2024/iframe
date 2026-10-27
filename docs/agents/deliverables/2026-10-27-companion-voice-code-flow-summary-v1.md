# Companion 语音与 OpenTalking 代码流程梳理（2026-10-27）

## 结论

当前页面已经能完成普通文字对话和 OpenTalking WebRTC 语音回复。当前实现是“分轮回复 + 持久媒体会话”，不是端到端实时语音对话。WebRTC 连接在聊天页生命周期内复用；每轮 Agent 文本回复完成后，前端把同一段文本提交给 OpenTalking 的 `render_text=true` 播报。

## 事实链路

```text
用户文字/语音输入
  → AgentChat
  → Companion API /sessions/{id}/chat
  → intent 分类 + 当前会话最多 20 条用户原话
  → Qwen UniArt（文字模式）
  → Turn 持久化
  → result.kind=text
  → spokenReply(turn_id, text)
  → OpenTalkingReply（页面级单实例）
  → 创建/复用 OpenTalking session
  → WebRTC offer/answer + SSE
  → /speak {text, render_text:true, command_id}
  → OpenTalking TTS / FlashTalk Mock
  → WebRTC audio/video track
  → 浏览器 video 播放
```

语音输入的当前默认 demo 路径是：

```text
麦克风 → AudioWorklet PCM → SilenceSegments（能量阈值分段）
  → /sensevoice-test/analyze（CPU SenseVoice）
  → 识别文字加入 AgentChat voiceQueue
  → 依次调用普通 chat
```

这条输入路径不是 WebRTC 上行语音，也没有把输入音频直接送入 OpenTalking。

## 模块职责

| 模块 | 职责 | 当前边界 |
|---|---|---|
| `AgentChat.tsx` | 会话、历史、文字发送、模式设置、回复文本分发 | 不负责媒体协商 |
| `CompanionComposer.tsx` | 聊天/图片/视频、上传、语音输入按钮 | 不负责 Agent 回复语音 |
| `useContinuousCapture.ts` | 麦克风 PCM、静音分段、SenseVoice 请求、排队 | 实验性本地 VAD，不是实时 WebRTC |
| `companionPlaybackQueue.ts` | 页面内播放互斥、打断、收音避让 | 只管理客户端播放任务 |
| `OpenTalkingReply.tsx` | 一个页面级 OpenTalking session、WebRTC、SSE、回复排队、清理 | 目前按完整回复提交 `/speak` |
| `SpeechPlayback.tsx` | 文字模式手动 UniArt TTS | 组件挂载不自动调用；卸载会释放 audio/blob |
| `DigitalCompanionPanel.tsx` | 另一条独立 Qwen Realtime WebSocket 面板 | 与普通聊天 WebRTC 回复不是同一条链路 |
| `src/apps/companion_runtime/model.py` | Qwen 普通聊天/工具提案 | 当前只把用户原话送给模型，不含助手历史 |
| `src/apps/companion_runtime/chat_store.py` | 用户消息、turn、结果、分页历史 | 最近上下文窗口为 20 条用户消息；历史可分页读取 |
| `src/apps/companion_runtime/realtime.py` | Qwen Audio realtime WebSocket | 语音面板的另一种方案，不参与 OpenTalking 普通聊天回复 |
| OpenTalking `render_text` overlay | 跳过第二次 LLM，直接把已生成文本送 TTS | 只影响明确带 `render_text=true` 的任务 |

## 语音输出已验证内容

- CPU Mock 同一 WebRTC 会话连续两轮返回非静音音频。
- 公网 UDP TURN relay 已收到可解码音频。
- 浏览器接收音频转成 PCM WAV 后，SenseVoice 能识别出中文语句，说明接收媒体包含可识别语音。
- 页面本地测试音可以播放；这排除了“Chrome 当前站点完全没有声音输出”的结论。
- 以上证据证明浏览器收到并解码了语音，仍不等于已经证明用户设备扬声器实际出声。

## 需要保留的边界

1. `queued`、`speech.ended`、音频 RMS、播放器 `paused=false` 都不能单独证明扬声器可听。
2. 当前普通聊天仍是“先生成完整文字，再提交 OpenTalking”，不是流式文本到 TTS。
3. `useContinuousCapture` 受播放队列控制，播放期间会丢弃/重置输入帧；这是半双工策略。
4. `DigitalCompanionPanel` 的 Qwen realtime WebSocket 与 OpenTalkingReply 不能同时视为一个会话。
5. 历史回复只恢复用户原话和最近一次结果；助手历史不会自动作为 Qwen 上下文发送。
6. `render_text=true` 是服务端新增的演示协议，旧 OpenTalking speak 行为保持不变。

## 当前测试与部署

- 前端语音/OpenTalking/历史播放聚焦测试：30 项通过。
- 播放诊断后：本地测试音、媒体清理、OpenTalking 会话保活均有测试覆盖。
- 前端 typecheck 和静态构建通过。
- 当前测试入口：`https://garage.uniart.fun/companion-demo/companion/agent`。
- 当前已部署构建标识：`9b09f225`。
- 尚未推送或合并。

## 下一步顺序

1. 保持当前可用版本，收集 Mac Pro + Chrome 的“本地测试音 / OpenTalking 回复”对照结果。
2. 如果本地测试音可听而 OpenTalking 回复不可听，优先检查 WebRTC audio track 到 media element 的绑定、track mute/ended 和浏览器输出设备，不改实时架构。
3. 如果两者都可听，再单独设计 Web Audio 输出切换实验；实验代码不直接进入稳定链路。
4. 输出链路稳定后，再评估把 OpenTalking 改成流式文本/句子播报，以及把听、思考、说拆成独立队列。

## 2026-10-27 追加：三条链路正式拆分

OpenTalking 输出已经通过用户自然语音测试确认可听，因此不再把输出问题与 SenseVoice 混为一谈。

```text
A. 文字聊天
用户文字
  → CompanionAgent/Qwen
  → 完整回复文字
  → 聊天流显示

B. 语音回复
同一份完整回复文字
  → OpenTalking /speak(render_text=true)
  → OpenTalking TTS + WebRTC
  → 浏览器播放

C. 语音输入
麦克风
  → AudioContext + AudioWorklet
  → SilenceSegments 按停顿切段
  → PCM WAV POST /companion-demo/sensevoice-test/analyze
  → SenseVoice 返回文字
  → 加入 AgentChat voiceQueue
  → 复用 A，再按设置进入 B
```

### SenseVoice 如何启用

在测试站中，进入聊天底部的“语音输入”：

1. 第一次点击后，在语音说明卡片中选择“持续收音（测试）”。
2. 点击“同意并开始聊天”。浏览器请求麦克风权限。
3. `useContinuousCapture` 创建 `AudioContext`，通过 AudioWorklet 持续读取 PCM。
4. `SilenceSegments` 检测约 900ms 停顿，将至少约 300ms 的语音段转成 PCM WAV。
5. 每段发送到同源 `/companion-demo/sensevoice-test/analyze`；服务端 CPU SenseVoice 返回识别文本。
6. 文本进入 `voiceQueue`，按顺序调用普通 `/sessions/{id}/chat`。识别不会直接调用 OpenTalking。
7. 若“更多 → 聊天设置”选择“语音回复”，该轮完整文字回复再进入 OpenTalking；选择“只回复文字”则只显示文字。

选择“浏览器识别”时，绕过 SenseVoice，使用浏览器 SpeechRecognition；这是另一条输入实现。SenseVoice 当前是 demo 测试服务，健康信息明确标记不保存录音、不连接聊天数据库。

### 队列边界

- SenseVoice 有自己的“待识别段队列”，避免网络请求并发破坏顺序。
- Agent chat 有自己的发送锁和 operation id，避免重复提交。
- OpenTalking 有自己的回复播放队列和 command id，保证一条 WebRTC session 内串行播报。
- `companionPlayback` 在播放时通知收音链路暂缓采集，当前策略是半双工：先听完回复，再继续说话；这不是 WebRTC 上行语音。
