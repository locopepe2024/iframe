# Companion 文本回放

本工具只测试后端文本链路，调用真实 chat API、请求组装与临时 SQLite，不访问生产数据库。完整场景与验收规则见 [测试规范](../../docs/specs/2026-10-26-companion-character-evaluation-v1.md)。

在仓库根目录执行（使用项目已有 Python 依赖）：

```bash
python3 scripts/companion_eval/check_cases.py
python3 scripts/companion_eval/replay.py --output /private/tmp/companion-eval-run-001
python3 -m pytest -q --disable-warnings tests/test_companion_evaluation.py
```

默认离线模式使用 `responses.synthetic.json` 中的人工上游消息。它验证模型请求、响应解析、工具确认和持久化边界，不验证模型语义能力。不要将 `synthetic_checks_ok` 报成场景通过；人工评审始终待评。

运行目录必须尚不存在。产物：

- `records.jsonl`：每条用例一行，包括实际请求、上游消息、API 结果、前后持久状态、检查依据与未执行原因。
- `summary.json`：来源类型、代码/适配器/用例哈希、时间和各状态数量。完整场景通过率保持 null。

退出码：0=所执行自动检查未发现失败；2=检查失败或适配器异常；参数/产物目录错误也会退出 2，终端会显示原因。CLI 成功不代表人工、浏览器或语音评测完成。

当前已知基线：D04“写一下今天的日记吧”未进入后端专用写作通道，因请求仍携带记忆工具而使检查失败。文本中的事实已送达，不应解释成“上下文丢失”。本适配器不执行前端，不能据此判断当前网站上的日记流程。

可选在线模式会产生真实模型请求，必须显式选择，不读取现有个人渠道密钥：

```bash
# 先通过安全的环境配置提供 COMPANION_EVAL_API_KEY，勿将密钥写入命令或日志。
python3 scripts/companion_eval/replay.py --mode live \
  --base-url https://uniart.fun/v1 --model qwen3.8-flash \
  --output /private/tmp/companion-eval-live-001
```

当前每次运行最多执行 5 条文本用例、每条一次模型请求，无自动重试。在线模式仍需人工审阅回复。无音频和不支持的初始状态不发请求。

本轮仅跑离线；尚未验证在线渠道可用性。计时只含后端和模型请求，不能代表用户首音延迟。固定日期仅用于存储时钟，当前模型未获得测试时钟。切勿将真实私人场景直接混入合成种子集。

## 日记工作域回放

```bash
python3 scripts/companion_eval/diary.py --output /private/tmp/companion-diary-run-001
```

运行真实 React 编辑器/日历组件及独立后端 SQLite 测试，收集 `frontend.json`、`backend.xml`、组件观察与 `summary.json`。组件测试注入识别文字并 mock API；没有真实录音，也没有同一次请求贯通前后端。命令不请求模型、不部署。

这里区分“回归测试执行成功”和“满足用户场景”：任一观察不满足用例时标记 `component_expectation_mismatch`，命令退出 2。报告缺失、子进程失败或超时一律不能计为通过。现有文件不能覆盖。

修正后的组件观察（修正前基线单独保留）：

- D01：编辑器中“开发语音图片和视频功能”作为日记正文保留，不进入聊天或自动保存。
- D02：自然说法“就先说到这里，停止”会暂停听写，原草稿保留且不自动保存。
- D03：“保存这篇日记”会暂停听写并显示确认，点击确认才提交；失败后保留草稿并用同一操作重试。
- D04：前端提交前将自然日记指令转换为日期明确的请求。这与绕过前端直接请求后端的边界不同。

这些观察来自组件模拟，不证明实际语音识别准确性。日记听写采用整句匹配的有限命令集合，否定、条件句和叙述不触发操作。未覆盖的自然说法仍可能被当作正文；这不是通用语义理解的准确率结论。

## 真实浏览器采集与识别诊断

macOS 示例（仓库根目录）：

```bash
python3 scripts/companion_eval/make_speech_fixtures.py --output /private/tmp/companion-speech-fixtures-001
node frontend/scripts/companion-microphone-probe.mjs \
  --wav /private/tmp/companion-speech-fixtures-001/stop.wav --expect-command stop \
  --output /private/tmp/companion-microphone-run-001
```

依赖已有 Chrome、Node/esbuild/ws、macOS Tingting 语音和 ffmpeg。脚本用临时浏览器 profile、虚拟麦克风与本地页面，真实调用 getUserMedia / WebAudio / SpeechRecognition；不 mock 识别结果，不写生产日记。原生识别由浏览器实际配置的服务处理，日志会保存收到的事件。

另一个通道将实际采集 PCM 发给现有 SenseVoice 测试服务，仅用合成素材。它不是产品供应商切换。每次三轮采集，每轮 6.5 秒，串行发请求；不同脚本同时运行可能触发 CPU 服务的 429，此结果必须保留，不自动重试掩盖。原生识别窗口为 15 秒，无非空 final 文本不算成功。

如 Chrome 日志明确出现 `Failed to read ... as input to the fake device`，本地隔离夹具实验可显式加 `--fixture-no-sandbox`，结果中记录该设置。这不是日常浏览器或生产部署配置；默认不启用。物理麦克风未测试，不以虚拟采集证明蓝牙、回声、老人说话或长时稳定。

产物包括阶段记录、最终 `summary.json` 和 Chrome 日志。`result` 事件含空字符串时不算识别成功；整体命令退出 2 表示采集、独立识别或原生识别至少一项未满足。静音不记为有效转写；API 失败不分类成普通正文。
