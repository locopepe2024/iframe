# H3 Ref2VA 任务语义对照

日期：2026-10-16。状态：本地资料对照；官方网页复核待网络可用后补充。

## Evidence level

| 结论 | 证据级别 | 来源 |
|---|---|---|
| `video editing` 与 `reference generation` 都属于 Ref2VA 任务语义 | 本地资料/待官方复核 | `Desktop/H3视频复刻.md` 第 18–30、77–100 行；本地 `h3-prompt-writing.md` |
| `video editing` 用于直接修改 `<Video 1>`，通常以 `The target video is an edited version of <Video 1>.` 开头 | 本地资料/待官方复核 | 本地文章第 81–89、118–122 行 |
| `reference generation` 用于以视频提供动作、运镜、节奏或结构参考，生成新视频 | 本地工作流规则 | `config/agent_skills/h3-product-recreation/SKILL.md`、`h3-prompt-writing.md` |
| iFrame 当前通过 `reference2video` 传送参考图片和源视频 | 代码事实 | `src/apps/recreation/service.py:995–1010`、`src/models/uniart.py:540–570` |
| API mode 名称本身不能证明模型采用哪一种任务语义 | 直接 implication | 当前请求 body 中 mode 与 prompt summary 是两个独立字段 |

## Definition

### `[reference generation]`

源视频是新视频的参考材料。它主要提供：

- 动作顺序和局部节奏
- 相机路径、景别和镜头结构
- 可见道具运动与场景关系

目标是生成一个新视频。源视频中的背景、人物身份、构图细节和像素不应被默认视为逐帧不变；需要在 `retention_analysis` 中逐项声明保留程度。

适合 iFrame 当前原片换人/动作迁移路线，但不能承诺原背景像素不变。

### `[video editing]`

源视频是要被编辑的目标视频。提示词应明确：

- `<Video 1>` 是被修改的原片
- 只改变授权对象或属性
- 运镜、场景、动作、遮挡、剪辑和未授权内容保持
- 新增或替换内容要通过 `attribute_transfer` 等关系说明

它仍然是 Ref2VA 的整帧重生成任务，不等于逐像素局部重绘。要获得原背景像素保持，需要额外做逐帧 mask、人工审核和合成。

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

s09 的 A/B 应保持同一 Ref2VA `reference2video` 请求，仅改变：

1. `summary` 任务标签；
2. `<Video 1>` 的职责定义；
3. `retention_analysis` 中的保留/转移关系；
4. detailed description 中使用“生成/参考”或“原片/保留”的动词。

E2 深俯身、E3 回升、E4a 第一次高举、E4b 回落/转背、E4c 第二次高举和 E5 前伸必须保持逐句一致。否则实验会同时比较任务语义和动作提示词，无法归因。

## Not yet proven

- H3 是否会因任务标签改变内部注意力或约束强度：未有本地运行证据。
- `[video editing]` 是否比 `[reference generation]` 更能保持 s09 的枪形、背景或动作时点：待受控生成。
- 本地文章引用的官方文档条款和社区经验：网络恢复后需重新读取官方原文和示例脚本。

## What would verify it

- 保存官方原文 URL、commit/tag、抓取日期和相关段落。
- 对同一 s09 输入各提交一次 A/B，记录完整请求 body、`reference2video` mode、seed、任务 ID 和输出哈希。
- 按同一事件表比较动作存在性、顺序、时间位置、持续时间、枪几何、人物身份、背景和 UI 杂质。
- 若两组结果不同，只能先称为 Ref2VA 任务语义差异；不能归因于独立 API mode。
