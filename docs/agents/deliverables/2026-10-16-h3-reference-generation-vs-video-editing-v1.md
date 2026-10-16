# H3 Ref2VA 任务语义对照

日期：2026-10-16。状态：已读取 MiniMax-AI 官方仓库固定 commit `d21241f0a4b3acbb34c97dae47fa417b7065e438` 的 `skills/h3-prompt-writing/references/ref-en.txt`。来源：<https://github.com/MiniMax-AI/MiniMax-H3/blob/d21241f0a4b3acbb34c97dae47fa417b7065e438/skills/h3-prompt-writing/references/ref-en.txt>。

## Evidence level

官方原文已通过公开 GitHub 页面读取；本地代码结论通过仓库源码核对。文章中的社区性能和质量叙述仍按未独立验证处理。

| 结论 | 证据级别 | 来源 |
|---|---|---|
| `video editing` 与 `reference generation` 均为 full-reference 提示词中的任务类型 | 官方文档事实 | 官方 `ref-en.txt` 第 3 节 `summary` |
| `video editing` 用于直接修改既有源视频；summary 必须在任务标签后以 `The target video is an edited version of <Video 1>.` 开头 | 官方文档事实 | 官方 `ref-en.txt` 第 3 节 |
| `reference generation` 用于图片、视频或音频提供生成指导，但它们不作为具体帧，也不作为直接编辑或续写的源视频 | 官方文档事实 | 官方 `ref-en.txt` 第 3 节 |
| `<Video N>` 可表示编辑源、续写起点或整片时间结构；可见人物/动作仍应定义为 `<Subject N>` | 官方文档事实 | 官方 `ref-en.txt` 第 2.3 节 |
| iFrame 当前通过 `reference2video` 传送参考图片和源视频 | 代码事实 | `src/apps/recreation/service.py:995–1010`、`src/models/uniart.py:540–570` |
| API mode 名称本身不能证明模型采用哪一种任务语义 | 直接 implication | 当前请求 body 中 mode 与 prompt summary 是两个独立字段 |

## Definition

### `[reference generation]`

源视频是新视频的参考材料。官方列举的用途包括动作、运镜、剪辑和节奏指导；它不作为直接编辑的源视频。它主要提供：

- 动作顺序和局部节奏
- 相机路径、景别和镜头结构
- 可见道具运动与场景关系

目标是生成一个新视频。源视频中的背景、人物身份、构图细节和像素不应被默认视为逐帧不变；需要在 `retention_analysis` 中逐项声明保留程度。

适合 iFrame 当前原片换人/动作迁移路线，但不能承诺原背景像素不变。

### `[video editing]`

源视频是要被直接修改的目标视频。官方要求 summary 在任务标签后以 `The target video is an edited version of <Video 1>.` 开头。提示词应明确：

- `<Video 1>` 是被修改的原片
- 只改变授权对象或属性
- 运镜、场景、动作、遮挡、剪辑和未授权内容保持
- 新增或替换内容要通过 `attribute_transfer` 等关系说明

官方 prompt guide 只规定任务语义与格式，不保证逐像素保持；文章称其为整帧重生成，这是文章的技术解释，尚未由本次读取的官方 guide 单独证明。要验收原背景像素是否保持，仍须直接测量输出；mask 和后期合成是可另行验证的工作流。

## Prompt contrast

### Reference generation

```text
summary:
[reference generation] Generate a new video based on <Video 1>.
Use <Video 1> for the action order, camera movement and local timing.
Replace the performer with <Subject 1> while preserving the specified
visible action phases and one coherent spear.
```

### Video editing

```text
summary:
[video editing] The target video is an edited version of <Video 1>.
Replace only <Subject 1>'s visible identity with the person from
<Picture 1>, preserving the source camera, scene, action order, timing,
occlusion and all other visible content.
```

## Same input, different responsibility

| 项目 | Reference generation | Video editing |
|---|---|---|
| `<Video 1>` | motion/structure reference | edited source video |
| 默认自由度 | 较高，允许重建画面 | 较低，强调未授权内容不变 |
| 人物替换 | 新主体承担目标身份 | 源主体槽位执行 `attribute_transfer` |
| 背景 | 声明保留程度即可 | 明确 `fully_preserved`，但仍需实测 |
| 遮挡 | 写出需要复现的可见关系 | 写出必须保留的原遮挡关系 |
| 失败判读 | 动作或结构缺失 | 未授权区域、镜头或动作被改写 |

## s09 application

s09 的 A/B 保持同一 Ref2VA `reference2video` 请求，比较一整套任务语义措辞：

1. `summary` 任务标签；
2. `<Video 1>` 的职责定义；
3. `retention_analysis` 中的保留/转移关系；
4. detailed description 中使用“生成/参考”或“原片/保留”的动词。

E2 深俯身、E3 回升、E4a 第一次高举、E4b 回落/转背、E4c 第二次高举和 E5 前伸的事实约束、时间窗和顺序必须一致。当前两份草案在主体定义、summary、retention 和动作句式上均不同，因此实验可比较整套任务语义提示词，不能把差异归因于单个方括号标签。若需单独测标签效应，须额外制作仅修改标签的第二组实验，并先确认该文本在两种标签下语义自洽。

## Not yet proven

- H3 是否会因任务标签改变内部注意力或约束强度：未有本地运行证据。
- `[video editing]` 是否比 `[reference generation]` 更能保持 s09 的枪形、背景或动作时点：待受控生成。
- 本地文章中的“整帧重生成”和社区成功率/失败率：未由本次官方 prompt guide 验证。

## What would verify it

- 已记录官方 prompt guide 的固定 commit、URL、读取日期和相关节；官方示例脚本尚未逐条核对。
- 对同一 s09 输入各提交一次 A/B，记录完整请求 body、`reference2video` mode、seed、任务 ID 和输出哈希。
- 按同一事件表比较动作存在性、顺序、时间位置、持续时间、枪几何、人物身份、背景和 UI 杂质。
- 若两组结果不同，只能先称为 Ref2VA 任务语义差异；不能归因于独立 API mode。
