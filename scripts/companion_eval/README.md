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
