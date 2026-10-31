# Companion 同步与播放期间打断评审

## 本次同步

功能源码版本：`bd2cc22b7dc3d33272d669fb2472273ec191b4ed`。
分支：`feature/agent-companion-skills-20261007`，已推送 GitHub；未合并 main。

- 测试入口：https://garage.uniart.fun/companion-demo/companion/agent
- 部署容器：`iframe-companion-demo`；只更新该独立 demo。
- 挂载根：`/srv/lumenx/companion-demo/releases/companion-57811135`。
- 回滚备份：`/srv/lumenx/companion-demo/backups/sync-bd2cc22b-20261031`，包含 runtime.tgz 和 companion-pages.tgz。恢复对应 source 模块和 web/companion 页面后重启该容器；保留旧哈希 chunks，无需删除数据。
- 构建从已提交源码隔离导出；仅为 node_modules 符号链接增加构建期 CSS realpath alias，不修改产品行为。不包含工作区其他未提交改动。
- 补齐原先仅在工作区存在的协调器客户端、照片原图 API 参数和引用类型定义；入口直接导入聊天组件也已纳入 Git。
- 部署只覆盖 9 个 Companion 后端模块及 Companion 静态页面/依赖资源，未更改密钥、用户数据、OpenTalking 服务或 SenseVoice 服务。

## Observed：验证与代码事实

隔离验证：73 项后端测试、33 项前端测试通过，独立 TypeScript 检查通过，静态导出成功。构建配置会跳过内置类型检查，因此以上类型通过来自独立命令。

运行观察：公开 health 为 ok；13 个脚本 URL 全部 200；9 个后端模块 SHA256 全部符合部署清单；运行容器已加载 voice-context 路由。公开 HTML 与本地构建 SHA256 一致：

`5ec253a7358cf0a79205e07867a0d1bf384ecc8055c94f3996a400a7cc3a0e22`

health 的 source_revision 仍是 wrapper 固定的 `57811135`，不是本次版本证明。真实清单位于主机 `web/companion-sync-manifest.json`；该 URL 当前未被网关公开（404），不可作为客户端版本接口。未自动更换 wrapper。

没有进行真实麦克风、手机外放、浏览器交互或物理扬声器测试；HTTP 检查不证明 hydration 或音频可听。

当前音频代码事实：

1. `useContinuousCapture.ts` 请求单声道、echoCancellation/noiseSuppression/autoGainControl=true，但未读取本地麦克风 track.getSettings() 验证实际生效设置。
2. `SilenceSegments` 是能量分段器：RMS >= .015 持续 80ms 进入活动段，静音 900ms 或总长 15s 切段。它不是人声、说话人或唤醒词识别。
3. `companionPlayback.blocksCapture()` 在回复播放及 350ms 尾部屏蔽麦克风 PCM；因此播放期间无法从当前分段器产生起声事件。
4. 已接起声事件可在等待回复期间递增 speechEpoch，阻止迟到的旧请求自动播报，但不能打断已播放中的语音。
5. OpenTalkingReply 已有接收音轨 AnalyserNode 和 RMS 检查，主要用于首次音频与诊断；未与麦克风提供同一时间基准的参考帧。
6. 手动取消通过播放队列 abort，静音远端播放器并调用当前 OpenTalking 会话 /interrupt；不要求断开 WebRTC 或关闭麦克风。完整工具生命周期由 Agent 继续维护。

## Direct implication：直接推论

开启能量检测时直接移除播放屏蔽，会让扬声器泄漏音频进入与用户相同的检测链。浏览器请求了 AEC 并不证明所有设备都足以消除该泄漏。

只加 Web VAD 也不足以区分用户和回声，因为二者都可能是人声。音量相似、远端轨仍有能量或 VAD positive 都不能单独作为打断结论。

ASR/SenseVoice 在分段后才执行，不适合独自承担低延迟起声决策。声音身份识别不在本版范围；旁人或电视人声仍可能触发，必须作为测试项而不是声称已解决。

## Not yet proven：尚未证明

- Chrome/macOS 与目标移动设备实际启用的 AEC 状态及抑制效果。
- WebRTC video 播放、扬声器音量、蓝牙/耳机切换对回声残留的影响。
- 老年人低音量、慢起声、停顿和口头语下的检测率。
- 双方同时讲话时，远端参考与近端麦克风信号能否稳定区分。
- 服务端结束事件与浏览器缓冲尾部的时间差；流程结束回执不证明物理声音已停止。

## Hypotheses：候选方案

建议先保留现有播放路径，增加影子检测，收集可验证证据；不立即更改默认打断行为。

候选链路：浏览器 AEC 后麦克风 → 人声概率/能量持续性 → 远端播放参考与延迟相关性 → 近端起声候选 → 播报抑制/打断。相关性只能提供回声证据，不独自裁决；双讲时不能因远端有声就拒绝用户。

如果单纯浏览器 AEC + VAD 达到以下测试标准，可省去更复杂的参考消除；如不能达到，再评估同一 AudioContext 的远端参考分支和独立 VAD。不要先重新接线所有音频或更改 WebRTC 上行。

候选 200–300ms 持续判定、300ms 本地预留起声片段、短暂 duck 后复核都只是实验参数，不是已验证的阈值。duck 会打扰播放，先在影子检测稳定后单独评估。

## What would verify it：验证步骤与成功条件

### A. 先只检测，不打断

- 读取本地麦克风 getSettings() 的 echoCancellation、noiseSuppression、autoGainControl、sampleRate、channelCount。字段不存在记 unknown，不能当作 false；不采集 deviceId/groupId、设备标签或用户原话。
- 在浏览器内存中统计采集 RMS、远端 RMS、人声候选起止、候选持续时间及播放状态。先不上传原始 PCM、不写入相册/记忆、不将播放期间候选送 ASR。
- 先记录较粗的汇总数值；不持续高频上报，不把诊断放进工具或 TTS 关键路径。页面关闭即销毁本地片段。
- 用户通过明确测试开关启用；现有聊天默认行为保持不变，方便对比。

### B. 固定测试矩阵

| 场景 | 预期 |
| --- | --- |
| 仅小安外放，用户不说话，低/中/高音量 | 不触发打断候选或记录为可排除回声 |
| 用户单独讲话：正常/轻声/慢起声 | 检测到近端起声，保留首字 |
| 小安外放时用户插话 | 在两人同时说话时识别用户起声 |
| 耳机模式 | 用户起声仍可识别，无扬声器回声误判 |
| 拍桌、咳嗽、风扇、键盘声 | 不当作可执行指令；候选误报单独计数 |
| 电视/旁人讲话 | 测量误触发；本版不能保证身份区分 |
| 打断临近 speech.ended、页面关闭或切换会话 | 不误记完成，不重复恢复旧语音 |

临时验收目标（需人审标注，未达成）：每设备/输出方式做 10 分钟只播放测试，0 次错误打断；至少 20 次正常插话，>=19 次成功、p95 从人工标注起声到停止播放 <=500ms；轻声单独报告，不用正常音量平均数掩盖失败。该规模只用于 Demo 选择，不构成稳定统计保证。

### C. 再接实际打断

- 只停止当前播报及其旧队列，调用 /interrupt；不取消上传、生成、保存等任务，不断开 WebRTC。
- 由起声递增 epoch，避免旧模型请求稍后再次抢话。
- 将近端起声前保留片段与后续声音接成一段，不能为了尾部屏蔽删掉首字；打断后仍要处理物理回声尾部。
- 明确区分 cancelled、failed、completed；取消不能进入已完成播报集合。自动恢复/重读旧回复不默认执行。
- 如果用户只说“停一下”，停止播报并等待，不让语音命令隐式取消后台任务。

## 参考来源

- MDN MediaTrackConstraints.echoCancellation：https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/echoCancellation 。浏览器决定 true 对应的消除方式；支持特定类型的能力不能由字段存在推断。
- MDN MediaStreamTrack.getSettings：https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getSettings 。返回当前轨道设置；须读取本地麦克风轨，远端 RTP 轨不保证携带 echoCancellation 信息。

以上页面于本次通过公开 HTTP 阅读。规范说明不等于当前用户设备运行验证。
