# Storyboard 与 Shot Design 视频输入契约 v1

状态：提案，作为实现与测试的边界文件。

## 1. 术语和职责

Storyboard 是镜头的视觉锚点与连续性准备阶段。它负责把导演拍摄计划落成一个可审核的参考包：场景构图、资产版本、光影/空间连续性、确认的首帧、可选尾帧和镜头参考素材。Storyboard 生成的是静态参考媒体，不提交视频任务。

Shot Design 是视频执行阶段。它消费一个已确认的 Storyboard reference package，负责提示词、模式、模型、时长、帧率、分辨率、音频、生成候选和最终提交。Shot Design 不得静默改写 Storyboard 的参考包。

两者共享同一个 `frame_id`，但保存不同 revision。视频任务必须记录实际消费的 `storyboard_reference_revision`。

## 2. 四种生成模式

| 用户入口 | 内部值 | 输入 | 规则 |
| --- | --- | --- | --- |
| 文生视频 | `t2v` | 提示词 | 不提交图片或视频参考；Storyboard 仍可提供文字连续性，但不作为媒体输入。 |
| 首帧图生视频 | `i2v` | 一张首帧 | 默认使用已确认 Storyboard 首帧；用户明确上传或重新生成的首帧可覆盖，但必须在提交前成为当前 shot input。 |
| 首尾帧视频 | `first_last_frame` | 首帧 + 尾帧 | 两张媒体都必须存在且可解析；默认来自已确认 Storyboard package。不能用同一张图冒充两帧。 |
| 全能参考视频 | `r2v` | 一张或多张图片/视频参考 | 只使用用户明确选择的参考素材；不得把 Storyboard 首帧隐式追加为普通参考。若产品选择把首帧作为 R2V 参考，必须显示并写入 snapshot。 |

`FL2V`、`F2V` 是供应商或 UI 的别名，持久化统一为 `first_last_frame`；`RF2V`、`R2V` 统一为 `r2v`。营销名称不进入数据契约。

## 3. 首帧和尾帧来源优先级

Shot Design 提交前构造不可变 `ShotGenerationInputSnapshot`，不直接把裸 URL 当作来源身份：

```text
mode: t2v | i2v | first_last_frame | r2v
first_frame_media_id: optional
last_frame_media_id: optional
reference_media_ids: []
storyboard_reference_revision: optional
prompt: string
duration: number
fps: number
resolution: string
model: string
```

I2V/首尾帧来源优先级：

1. 用户在 Shot Design 明确确认的上传/新生成媒体；
2. 已确认 Storyboard package 的首帧/尾帧；
3. 没有可用媒体时阻止提交。

Storyboard 的首帧不能只作为缩略图展示；当它满足第 2 项时，进入 I2V 必须自动成为当前可见、可替换、可追溯的首帧候选。用户在 Shot Design 重新生成或上传后，新的媒体覆盖本镜头当前输入，但不修改 Storyboard package。

Storyboard revision 变化后，旧的 Shot Design snapshot 标记为过期，提交前必须重新确认输入。

## 4. Storyboard 静态帧生成

Storyboard 帧率不是图片属性，也不是由 LLM 自由生成的字段。Storyboard 只保存镜头时间建议：`duration` 和可选 `fps`。首帧图片使用项目画幅/镜头构图和已锁定的资产、光影上下文生成；它不能从 Shot Design 的历史 T2I 候选反向推导。

建议优先级：

```text
shot.fps_override > project/series fps default > model catalog default
```

最终 FPS 在 Shot Design 提交时解析并写入 `ShotGenerationInputSnapshot`/`VideoTask`。供应商不支持 FPS 时，adapter 可忽略该参数，但必须保留结构化值和实际 provider 参数记录。Storyboard 生成首帧不应因视频 FPS 改变而重复生成。

## 5. 当前实现缺口

- `StoryboardReferencePackage` 已有首帧/尾帧 media identity 和 revision，但 Shot Design I2V 仍主要读取 `t2i_image_urls`、`shot.imageUrl`。
- 当前 UI 只暴露 `t2i_i2v` 与 `direct_r2v`，缺少显式首尾帧入口和 T2V 入口。
- `VideoTask` 有 `generation_mode`，但缺少统一的首尾帧模式校验和最终 FPS 快照。
- `StoryboardFrame` 没有明确的 `fps` 字段，现有 `duration` 定义重复且未形成提交链路。

## 6. 首帧提示词来源与一致性约束

首帧提示词必须区分“事实来源”和“生成文本”。推荐的权威顺序如下：

```text
剧集/项目视觉风格
  -> 当前镜头继承或明确覆盖的光影基线
  -> 当前镜头的场景、角色、道具与空间事实
  -> 当前镜头的景别、机位、构图、动作和转场状态
  -> 用户明确的首帧补充要求
  -> 图像模型可执行的正向/负向表达
```

其中前四层是结构化上下文，不应由模型重新猜测；最后一层才是 LLM 或提示词组装器的输出。首帧生成应保存 `prompt_source_revision` 或等价 lineage，能够回答每段文字来自哪个剧集、镜头或用户修改。

当前代码路径的事实：

1. `StoryboardGenerator.generate_frame()` 在没有显式 prompt 的批量路径中，只拼接 `action_description`、角色描述、场景描述和 `camera_angle/camera_movement`。它没有自动拼接 `storyboard_visual_style()` 的项目风格，也没有自动拼接 `lighting` 或 `director_shot_context`。
2. 单帧渲染路径 `generate_storyboard_render()` 使用界面提交的 prompt；未标记为完整或已保存润色快照时，才追加 `director_shot_context`。风格和光影只有在润色请求构造 `custom_prompt` 时进入模型结果，不能假设所有渲染路径都有它们。
3. 分镜分析/细化阶段会把剧集视觉风格、导演执行上下文和镜头光影写入 `StoryboardFrame`，但这不等于后续首帧批量生成已经消费这些字段。

因此，当前存在一个已定位的漂移边界：分镜结构化数据包含风格/光影，首帧批量生成却可能只消费场景和角色文本。这是代码事实；它导致实际画面不一致仍需通过请求日志或生成结果统计验证。

目标实现应提供一个按镜头工作的服务端 `build_storyboard_frame_prompt(frame, script, assets)`，作为批量生成、单帧渲染预览和重新生成的共同投影入口。它们共享投影规则，但每个分镜都必须根据自己的 `frame_id` 生成独立结果：使用本镜头的场景、角色、动作、景别、机位、光影、转场和前后镜头连续性；只继承经过确认的剧集/场景基线，不复用其他分镜的完整提示词。LLM 润色只改写当前镜头投影后的文本，不在返回结果后再次追加同一约束。首帧和视频提示词可以共享当前镜头的事实投影，但视频动作扩展和 provider 字段必须保持在 Shot Design 层。

## 7. 实施顺序与验收

第一阶段：不改变 provider 路由，建立 Storyboard 首帧到 I2V 的自动绑定、明确来源标记、首尾帧校验和 revision stale 检查。

第二阶段：在 Shot Design 暴露 T2V、I2V、首尾帧、R2V 四个模式，统一构造 snapshot；保留旧 `t2i_i2v`/`direct_r2v` 作为兼容映射。

第三阶段：补齐 `fps` 的项目默认、镜头覆盖和 VideoTask 快照，并将供应商能力校验放入 adapter 边界。

必测行为：

- 已确认 Storyboard 首帧自动进入 I2V 当前输入；
- Shot Design 上传/新生成首帧后覆盖当前输入但不改 Storyboard；
- 首尾帧缺一或两帧相同则拒绝提交；
- R2V 不隐式混入首帧，T2V 不提交任何媒体；
- Storyboard revision 变化后旧 snapshot 不能直接提交；
- FPS 按优先级解析并写入最终任务快照。

本规范不声称供应商目前已支持所有模式；provider capability 仍需以 catalog 和 adapter 的实际验证为准。
