# H3 舞蹈提示词与视频审核失败状态：待完成任务

日期：2026-10-13。优先级：先定位并修复 H3 视频生成的审核失败状态回传，再导入舞蹈技能测试。

## 1. H3 视频任务显示“生成中”，UniArt 已显示“审核失败”

### Observed（代码事实与用户反馈）

- 用户明确：发生在 H3 **视频生成**，不是 H3 Context-IR 提示词优化。UniArt provider task ID 为 `task_zQXIVPgzZsWZ2aRDui1P8UWz6gfpoprC`。
- 运行时观察：UniArt 日志显示 2026-10-13 15:01:31 任务失败；之后来自 iFrame 主机的 `/v1/videos/{task_id}` 查询返回 HTTP 500。UniArt 数据库将任务记录为 `FAILURE`，公开原因是 `H3 task submission failed`，保存的响应状态为 `submission_unknown`。本次未验证原始供应商错误是否明确为内容审核失败。
- 修复前，`src/models/uniart.py` 的视频 `_poll()` 对所有 HTTP 5xx 每 10 秒重查，生产调用没有等待上限。修复后，视频查询 5xx 立即以包含上游错误码、消息和 request ID 的异常结束；iFrame 后端已有异常处理将任务写为 `failed`。408/429 及图像查询行为未改。
- Studio 分镜由 `src/apps/comic_gen/pipeline.py` 的 `process_video_task()` 调用 `UniArtVideoModel`；适配器抛错后将视频任务写为 `failed`。`frontend/src/components/modules/StoryboardR2V.tsx` 按 iFrame 任务状态更新镜头。
- Playground 视频由 `src/apps/playground/service.py` 的 `process_generation()` 调用同一适配器；适配器抛错后将生成记录写为 `failed`。Playground 页面轮询 iFrame 生成状态。
- 本次失败发生于 Studio 分镜还是 Playground 视频入口，仍需用 iFrame 任务 ID 确认。

### Direct implication（直接推论）

这次 iFrame 无法得到可解析的 `status=failed`，因为 UniArt 查询返回 HTTP 500。修复前，iFrame 将该 500 当作临时查询故障无限等待。现在 5xx 会结束 iFrame 视频任务并保留上游错误；供应商内部如何重试仍由 UniArt 决定。

### Not yet proven（尚未证明）

UniArt 查询返回 500 的服务端根因、原始供应商审核码、对应的 iFrame 本地任务 ID 和入口尚未确认。代码修改只解决 iFrame 对 5xx 的无限等待；线上修复效果仍需部署验证。

### Hypotheses（待验证假设）

1. UniArt 对这个终态任务生成 500 的原因可能是失败响应转换错误；需由 UniArt 服务侧验证。
2. iFrame 的任务记录未通过 provider task ID 定位到，可能存在不同持久化位置或任务 ID 未落库；需线上核查。

### What would verify it（验证与修复任务）

- [x] 定位 iFrame 无限等待边界：视频查询 HTTP 500 被适配器无限重试。
- [x] 修改 iFrame 视频 5xx 处理并加回归测试；500/502/503 均只查询一次，87 项相关测试通过。
- [ ] 部署 iFrame 修复并核对任务从 5xx 到 `failed` 的后端持久化与前端错误展示；现有任务不会因代码发布自动重放查询。
- [ ] UniArt 服务侧确认本次 500 的原因，优先修复终态任务查询，使其返回可解析的 `status=failed` 和准确失败原因。
- [ ] 核对 Studio/Playground 入口与任务 ID，验证失败后可明确重试、不会由 iFrame 自动重新提交付费视频任务。

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
