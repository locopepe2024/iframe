# H3 舞蹈提示词与视频审核失败状态：待完成任务

日期：2026-10-13。优先级：先定位并修复 H3 视频生成的审核失败状态回传，再导入舞蹈技能测试。

## 1. H3 视频任务显示“生成中”，UniArt 已显示“审核失败”

### Observed（代码事实与用户反馈）

- 用户明确：发生在 H3 **视频生成**，不是 H3 Context-IR 提示词优化。UniArt 已显示“审核失败”，iFrame 仍显示“生成中”。尚未取得这次任务的脱敏视频查询响应、provider task ID、iFrame task ID 或前后端日志，因此尚未完成运行时复现。
- `src/models/uniart.py` 的视频 `_poll()` 查询 `/videos/{task_id}`，只将顶层 `status` 为 `failed`、`error`、`cancelled`、`canceled` 视为失败；对未识别值每 10 秒继续查询，生产调用没有 `max_wait` 上限。
- Studio 分镜由 `src/apps/comic_gen/pipeline.py` 的 `process_video_task()` 调用 `UniArtVideoModel`；适配器抛错后将视频任务写为 `failed`。`frontend/src/components/modules/StoryboardR2V.tsx` 按 iFrame 任务状态更新镜头。
- Playground 视频由 `src/apps/playground/service.py` 的 `process_generation()` 调用同一适配器；适配器抛错后将生成记录写为 `failed`。Playground 页面轮询 iFrame 生成状态。
- 本次失败发生于 Studio 分镜还是 Playground 视频入口，仍需用 iFrame 任务 ID 确认。

### Direct implication（直接推论）

若 UniArt 的视频审核失败以其他顶层状态值、嵌套状态或非终态状态加错误字段返回，当前视频轮询不会立即结束，iFrame 视频任务会继续显示处理中。若 UniArt 已返回代码识别的顶层 `failed`，则应检查任务 ID 是否对应、worker 是否仍在运行、iFrame 状态是否落库，以及前端是否读取了最新状态。

### Not yet proven（尚未证明）

故障的具体边界、UniArt 视频查询响应的字段和值、线上 API/worker 运行版本及 iFrame 入口均未确认。不能仅依据供应商页面的中文“审核失败”推定 API 的 `status` 值。

### Hypotheses（待验证假设）

1. UniArt 视频异步响应的审核终态没有进入现有终态集合。
2. 审核错误位于 `error` 或其他嵌套字段，顶层 `status` 仍为 `processing`。
3. 用户看到的 UniArt 视频任务与 iFrame 当前等待的 provider task ID 不一致，或 worker/API 已标记失败但前端仍保持旧等待状态。

### What would verify it（验证与修复任务）

- [ ] 获取 iFrame 视频任务 ID、provider task ID、入口（Studio 或 Playground）、脱敏的 `/videos/{task_id}` 响应（仅状态、错误码、错误消息、请求 ID）及时间戳；关联 worker 日志和 iFrame 任务状态。不要记录提示词、附件 URL 或凭据。
- [ ] 确定失败发生在 UniArt 视频轮询、worker、iFrame 状态持久化还是前端展示层。记录复现步骤与线上 API/worker 版本。
- [ ] 用真实响应结构做最小回归测试，确保审核失败立即结束轮询、iFrame 视频任务落为 `failed`、前端显示可理解的失败原因，并允许用户修改后明确重试。
- [ ] 若上游只是暂时性观测错误，保持对同一 provider task ID 的轮询；不要重新提交付费任务。验证成功与普通失败路径不受影响。
- [ ] 完成部署后，用一次实际审核失败任务核对 UniArt 视频终态、iFrame API、视频任务 UI 三处状态及时一致。

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
