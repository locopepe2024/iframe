# OpenTalking CPU Mock 测试部署

## 范围与成功标准

用户授权在 iframe 独立端口运行 CPU Mock，复用远端 LLM/TTS，验证角色画面、音频、打断和销毁。先通过这一阶段，再决定接入 GPU QuickTalk。与 Companion 的日记、记忆、听写及生产 iframe 隔离，不推送或合并分支。

成功标准分两层：自动客户端验证真实解码画面/非静音音频、打断清空旧媒体、销毁状态；人工浏览器验证角色展示、播放听感及控件交互。后者尚未完成，不能以 API 200 或健康检查代替。

## 已部署

- 入口：<https://garage.uniart.fun/opentalking-mock/>。
- iframe 后端：`127.0.0.1:18083`；独立 HTTPS 静态站与代理：3444。
- 3444 主机内返回 200，外部连接超时，原因尚未定位；443 子路径代理到 3444，已从外部验证页面、角色预览、模型目录与会话 API。
- 容器：`iframe-opentalking-mock`；镜像：`iframe-opentalking-mock:deps-8c739a5`；host 网络、2 CPU、2 GiB 内存限制、`unless-stopped`。
- 源码：iyi-sgp `/opt/opentalking`，commit `8c739a5a6f114daf71aeace832a668c3ad60f536`，复制到 `/srv/lumenx/opentalking-mock/source`；未修改上游业务源码。
- 单进程 unified 模式，内存 broker，无外置 Redis、torch 或 GPU 模型下载。已验证容器重启后健康检查恢复。
- 测试素材：上游 `office-woman`。Mock 输出静态角色帧，不产生真实口型或 3D 骨骼动画。
- LLM：UniArt `qwen3.8-flash`；TTS：`qwen-audio-3.0-tts-flash` / `longanhuan_v3.6`，OpenAI-compatible `audio/speech`，wav。
- 上游创建文字会话也检查 STT 配置，因此配置目录中存在的 `asr-1.0`。现已开放会话的 `transcribe`、`speak_audio`、`speak_audio_stream`，其余管理写入仍关闭。

## 实测证据

运行 `docs/agents/tools/opentalking-mock/probe.py`，使用合成季节介绍文字，不使用私人照片或日记：

| 验证 | 同机 aiortc | 外部 aiortc，经 HTTPS 公网入口 |
|---|---|---|
| 解码视频帧 | 336 | 478 |
| 解码音频帧 | 57 | 51 |
| 非静音帧（峰值 >100） | 35 | 36 |
| interrupt 后 1.5 秒起旧音频 | 无后续音频帧 | 无后续音频帧 |
| DELETE 后会话状态 | closed | closed |

代码事实：上游 interrupt 取消合成任务、清空媒体队列并重置时钟；close 关闭合成客户端、媒体程序和 WebRTC，然后写入 closed。运行结果支持本次测试的音频终止和销毁状态；不等于已证明长期无泄漏、所有网络均可达或浏览器连续播放流畅。

远端 TTS 首段 PCM 曾分别约 35 秒和 9.3 秒返回；这是请求等待时间，不应归因于本地缓冲。尚未做延迟分布或稳定性统计，不保证实时响应。

浏览器自动化尚未执行，等待该工具范围的用户授权；人工可直接访问测试入口验证。尚未完成移动浏览器、自动播放限制、切后台和断网重连验收。

### 语音入口修复

首次人工测试 `speak_audio` 返回 Nginx 403。访问日志确认请求被部署白名单拦截，未到后端；这是代理配置遗漏，不能归因于 ASR 渠道。扩展上述三个语音端点白名单后，nginx -t/reload 通过。

使用系统合成的英文短音频，经公网 multipart POST `speak_audio`，实际返回 `status=queued` 和准确识别文本 `Hello, this is a speech recognition test.`，证明本次上传、远端 ASR、识别文本进入回复队列成功。测试会话随后 DELETE 关闭。`transcribe` 无文件请求返回后端 422（不再为 Nginx 403）；`runtime-config/apply` 仍为 403。WebSocket 语音入口已放行但尚未实测，中文口音/浏览器录音仍需人工复验。

## 部署与复验

服务目录 `/srv/lumenx/opentalking-mock` 中：source/（上游代码）、web/（上游 Vite build）、data/（独立 SQLite/资源）、start.py、`.env`。`.env` 从现有 demo 渠道在主机内复用，权限 600，不提交、不打印。导出过程中 Companion 容器内的临时凭据副本已删除。

依赖构建参考相邻 tools/opentalking-mock/Dockerfile；实际镜像由已有 iframe 基础镜像安装同等依赖后提交生成。基础镜像提供的包并未全部重新锁定，不声称完全可复现构建。启动：

```sh
docker run -d --name iframe-opentalking-mock --network host \
  --restart unless-stopped --memory 2g --cpus 2 \
  -v /srv/lumenx/opentalking-mock:/mock -w /mock/source \
  --entrypoint python iframe-opentalking-mock:deps-8c739a5 /mock/start.py
docker exec iframe-opentalking-mock python /mock/probe.py
```

外部复验需 Python 环境安装 aiortc/httpx/numpy：

```sh
MOCK_TEST_BASE=https://garage.uniart.fun/opentalking-mock/api python probe.py
```

Nginx 独立站参考 tools/opentalking-mock/nginx.conf；443 路径由 install-path.py 添加，安装前保存原配置、`nginx -t` 成功才 reload。渠道配置、资产与其他管理写入在公开代理返回 403，已实测 runtime-config/apply 为 403。页面仍是上游测试 UI，非适老版最终交互。

停用仅需 `docker stop iframe-opentalking-mock`；移除入口需恢复 `/srv/lumenx/opentalking-mock/nginx-backup-*.conf` 中本次部署前备份，再 nginx -t/reload，并停用独立站。不要覆盖其他后续 Nginx 修改。数据与凭据留在独立目录，不能通过公开静态根目录读取。

## 下一阶段门槛

### 人工反馈：文字返回但看不到角色

运行观察：用户这次会话的 STT、LLM、TTS 均返回成功，但 WebRTC 所有候选对失败，最终 `ICE failed` 并自动关闭会话。服务端生成帧不能证明该浏览器收到帧；此前外部 aiortc 成功仅覆盖当时测试客户端的网络，不能推广到这次浏览器。

代码事实：上游 startPlayback 在 SDP answer 应用后即返回，App 随即显示 live，未等待 RTCPeerConnection connected。已新增可复用前端 overlay（tools/opentalking-mock/patch-web.py），等待媒体 transport connected，失败/超时关闭 peer 并显示错误，不再把 SDP 完成当作已连接。4 项状态行为测试、前端 typecheck 和 build 通过。没有据此声称当前用户媒体问题已解决。

中继准备：iframe 新建隔离 `iframe-opentalking-turn`（coturn 4.6.3），TCP/UDP 3478，UDP relay 49160–49200，认证、配额与资源限制；配置位于独立服务目录的 mode-600 文件。外部 TCP 3478 实测超时，主机过滤链未见这些端口的阻断；云安全组是否阻断尚未证明，需要用户核对/放行或提供已有可用 TURN。设置仅写入 turn-env.json，**未应用到运行中 Mock**，避免强制切入不可达中继。未改变防火墙规则。设置包含客户端必需的临时 demo TURN 凭据，不能输出日志或提交；长期部署需短期凭据签发与访问控制。setup-turn.py 是一次性初始化脚本，不能重复运行覆盖现有凭据。

浏览器自动化范围授权与端口可达性处理仍待用户答复。当前仍不满足这一浏览器的播放验收，不连接 GPU。

### 安全组放行后的中继验收

用户确认已放行 TCP/UDP 3478 和 UDP 49160–49200 后，外网 TCP 3478 连接成功。执行 tools/opentalking-mock/apply-turn.py，将 staged TURN 配置应用到 mode-600 .env 并重启 Mock；原配置备份为 `.env.before-turn`。浏览器策略现为 relay，包含 TCP/UDP TURN URL；服务端保持 STUN 配置，媒体从同机 TURN 转发给服务端。未改动其他服务或云防火墙。

外部探针设置 `MOCK_TEST_RELAY=1`，读取测试站 ICE 配置，选择 TURN/TCP，在 aioice 层强制 relay-only，断言 offer 所有候选均为 relay。结果：解码视频 204 帧、音频 54 帧，其中非静音 49 帧；interrupt 后 1.5 秒起没有旧音频帧；DELETE 后 state=closed。支持这次公网 TURN/TCP 的播放、打断和销毁；不是 UDP TURN 或用户浏览器的验收。探针途中出现一次 aioice CHANNEL_BIND 400（相同 peer 使用不同 channel），测试仍完成；未证明此告警的普遍影响，不隐藏该限制。

当前可请用户刷新后创建新会话复验。旧会话不自动切换 ICE 配置；本次重启会关闭旧会话。仍不接 GPU，等待实际浏览器播放确认。

### 两句后异常：持续连接验证与 UDP 配置

用户报告两句后异常。该会话日志中 ASR/LLM/TTS 成功、回复合成完成，随后 `Consent to send expired`，WebRTC 自动关闭；页面仍能发起录音。资源观察为 Mock 约158 MiB、TURN 约5 MiB，无当时资源耗尽证据。不能将此次异常归因于模型内容或 CPU 性能。

外部 TCP relay-only 长连接复现 consent 过期，包含不发送文字、空闲65秒的情况。移除 Docker 网桥候选、服务端 STUN、公网 relay 映射的对照仍失败，这些修改已全部撤回。保活机制未被关闭或放宽。仅包头诊断显示保活请求/应答，不保存包内容；尚未定位 TCP 路径保活失败的底层机制。

UDP relay-only 在空闲65秒后可播放；随后恢复原始网卡/STUN/公网 relay 映射，只将浏览器 TURN URL 固定为 UDP，验证首轮播放→保持75秒→第二轮有效音频→打断→销毁通过：2822视频帧、809音频帧、694非静音帧，打断1.5秒后无旧音频，销毁closed。探针仍出现一次 CHANNEL_BIND 400，未阻止本次验证，不声称消除全部协议告警。这一对照支持使用UDP作为当前验证通过的配置；不是对TCP底层原因的完整诊断，用户浏览器仍需复验。

前端 overlay 增加已连接会话的失败监测：failed/closed立即结束，disconnected保持8秒后结束；显式销毁先解除监测，避免误提示。媒体断开后清空session并退出live，停止继续向已关闭会话录音。5项行为测试、typecheck、build通过并部署。此保护不替代媒体修复。配置/探针本地提交，不推送，不连接GPU。

先人工确认角色能显示、声音能播放、点击打断后停止、结束后能重新创建会话；若有失败，定位具体媒体或 UI 边界。通过后另行确认 GPU 资源与模型服务契约，再连接 QuickTalk，沿用同样的生命周期探针。当前没有部署或连接 GPU backend。
