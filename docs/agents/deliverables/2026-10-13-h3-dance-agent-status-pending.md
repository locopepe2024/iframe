# H3 舞蹈提示词与 Agent 审核失败状态：待完成任务

日期：2026-10-13。优先级：先定位并修复 Agent 的审核失败状态回传，再导入舞蹈技能测试。

## 1. Agent 显示“生成中”，UniArt 已显示“审核失败”

### Observed（代码事实与用户反馈）

- 用户反馈 UniArt 已返回“审核失败”，iFrame Agent 仍显示“生成中”。尚未取得这次任务的脱敏响应、任务 ID、前后端日志或浏览器网络记录，因此这是用户观察，尚未完成运行时复现。
- `src/apps/agent_api.py` 的 H3 Agent 消息走 `complete_h3_context_ir()`，同步等待 UniArt Context-IR；服务端的会话 `busy` 在请求结束时释放。
- `src/models/uniart.py` 的 `_poll_context_ir()` 只将顶层 `status` 为 `failed`、`error`、`cancelled`、`canceled` 视为失败。其余未识别值继续轮询，默认最长 1800 秒。
- `frontend/src/components/modules/playground/useAgentConversation.ts` 在消息请求未完成期间保持 `busy`，显示等待状态；它也按服务端会话 `busy_until` 刷新。
- 当前测试只覆盖 Context-IR 的顶层 `status=failed`，没有覆盖该任务实际审核失败响应。

### Direct implication（直接推论）

若 UniArt 的审核失败以其他顶层状态值、嵌套状态或非终态状态加错误字段返回，当前轮询不会立即结束，Agent 会继续显示等待，直到超时或请求断开。若 UniArt 已返回代码识别的顶层 `failed`，则应继续检查实际请求是否仍在同一任务、API 是否已结束以及前端会话状态是否刷新。

### Not yet proven（尚未证明）

故障的具体边界、UniArt 这次响应的字段和值、线上运行版本以及是否是 Context-IR 请求均未确认。不能仅依据供应商页面的中文“审核失败”推定 API 的 `status` 值。

### Hypotheses（待验证假设）

1. UniArt 异步响应的审核终态没有进入现有终态集合。
2. 审核错误位于 `error` 或其他嵌套字段，顶层 `status` 仍为 `processing`。
3. 用户看到的 UniArt 任务与 Agent 当前等待的 interaction ID 不一致，或 API 已失败但前端仍保持旧等待状态。

### What would verify it（验证与修复任务）

- [ ] 获取这次任务的 interaction ID、脱敏的 Context-IR `POST`/`GET` 响应（仅状态、错误码、错误消息、请求 ID）及时间戳；关联 iFrame API 日志和前端 `/agent/sessions/.../messages` 请求结果。不要记录提示词、附件 URL 或凭据。
- [ ] 确定失败发生在提交、UniArt 轮询、Agent API 响应、会话 `busy` 持久化还是前端展示层。记录复现步骤与线上版本。
- [ ] 用真实响应结构做最小回归测试，确保审核失败立即结束轮询、Agent 请求返回明确错误、会话可再次发送，并保留用户输入以供修改重试。
- [ ] 若上游只是暂时性观测错误，保持对同一 interaction ID 的轮询；不要重新提交付费任务。验证成功与普通失败路径不受影响。
- [ ] 完成部署后，用一次实际审核失败任务核对 UniArt 终态、iFrame API、Agent UI 三处状态及时一致。

## 2. H3 Dance Director Skill 的调用顺序

### 已有契约（代码事实）

`config/agent_skills/h3-prompt-writing.md` 已区分 T2VA、I2VA 首帧与 Ref2VA 全参考：T2VA 和关键帧模式使用三字段；Ref2VA 使用六字段。输入图片是否为视频 0 秒实际首帧，决定 I2VA 与 Ref2VA 的选择。`fully_copy` 只用于实际复用原音轨。

### 待完成设计与验收

- [ ] 定义调用顺序：识别用户目标、实际媒体与 H3 模式 → 舞蹈 skill 设计音乐段落、重心转移、连续动作、服装响应和摄影节奏 → H3 skill 按已选模式编译三字段或六字段，并校验引用槽位、时间戳和声音关系。
- [ ] 舞蹈 skill 输出供 H3 编译的动作方案，不自行固定三字段或六字段；同一编舞方案可以按不同的合法输入模式编译。
- [ ] 以短时长单镜和多镜分别测试动作密度。将“5–10 个核心动作”视为可调整的设计参考，避免把 15 秒硬塞成过多动作。
- [ ] 有实际音频时以音频段落为准；无音频时只写创作目标，不捏造 BPM、鼓点或副歌位置。参考图仅作身份参考时不得误作实际首帧。
- [ ] 测试 Agent 可复制稿的引用名称、H3 提交格式及人物身份、服装、动作连续性；区分格式检查通过与上游实际生成效果通过。

状态：两项均待完成；此文档记录排查边界与工作顺序，不表示故障已修复或舞蹈技能已导入。
