# s09 H3 task-label A/B 验证计划

日期：2026-10-16。状态：待提交；本文件是验证计划，不是生成结果。语义对照见 [H3 Ref2VA 任务语义对照](2026-10-16-h3-reference-generation-vs-video-editing-v1.md)。

## Observed

- iFrame 当前把源视频作为 `ref_video_urls` 提交，UniArt 模式为 `reference2video`，提示词使用 `[reference generation]`。
- H3 文章建议：源视频被直接修改时使用 `[video editing]`，并以 `The target video is an edited version of <Video 1>.` 开头。
- s09 切前单镜头为局部帧 `[0,112)`，帧 112 是硬切；源片有两次独立高举：69–73 与 82–87，中间 74–81 为回落/转背。
- 现有 `s09-action-v2` 是历史 `reference2video` 结果，不能作为本次 A/B 的同批对照。
- 文章将 `video editing` 定义为 Ref2VA 的任务类型；它不要求存在一个名为 `video editing` 的独立 provider mode。iFrame 当前用 `reference2video` 传输 Ref2VA 输入，UniArt 的 `v2v` 兼容映射也归入该 mode。

## Direct implication

本次比较完整的 Ref2VA 任务语义提示词（标签、源视频职责、保留关系与动词）是否改变可观察结果，不能单独归因为方括号标签。两组必须使用同一源视频窗口、人物图、模型、时长、分辨率、比例、静音策略和 seed；不得把 mask、裁剪、动作事实约束或后处理同时改动。

## Test matrix

| 组别 | summary 语义 | provider 输入 | 其余条件 |
|---|---|---|---|
| A | `[reference generation]`；源片提供动作、运镜、节奏，生成新视频 | `reference2video`，同一 `<Video 1>` | 固定 |
| B | `[video editing] The target video is an edited version of <Video 1>.`；只替换指定人物身份，其他内容声明保留 | 同一 `reference2video` Ref2VA 输入路径；任务类型由 prompt 语义指定 | 固定 |

B 组仍不能仅凭标签变化宣称效果改善：必须记录实际请求 body、provider mode、任务 ID 和输入指纹。两组都属于 Ref2VA；本实验比较的是 Ref2VA 内 `[reference generation]` 与 `[video editing]` 的任务语义，不是两个模型或两个 API mode。

离线验证：H3 prompt 结构检查及 UniArt 视频引用序列/URL 传输相关测试通过；完整 `tests/test_uniart_video_urls.py` 仍有既有 playground duration 缺失测试失败，与本计划文件无关。

## Acceptance sheet

按源事件逐项评分，先判是否存在，再判时间：

1. E2 深俯身：局部帧 34–60。
2. E3 回升：局部帧 61–65。
3. E4a 第一次高举：局部帧 69–73。
4. E4b 回落/转背：局部帧 74–81。
5. E4c 第二次高举：局部帧 82–87。
6. E5 前方展开：局部帧 88–111。

每个事件记录 `equivalent / absent / unscorable`，以及：顺序、首次出现时间、峰值时间、保持时长、正常速连贯性。另记录人物身份、枪尖/枪尾/红缨、握点、UI/边框、背景变化和输出时长。缺失事件不拟合全段倍速，也不把第一次高举和第二次高举合并。

## Not yet proven / Hypotheses

- `[video editing]` 是否会提高动作时间线或未授权区域保留：未有受控样本。
- provider 是否因 Ref2VA 任务标签改变内部约束或权重：当前代码无法证明，需以同条件生成结果验证。
- 文章中的背景保真和快动作结论能否迁移到 s09：未验证。

## What would verify it

- 先做离线 prompt 校验，并保存 A/B 完整 prompt、sha256、请求参数和输入指纹。
- 只有在 G2 动作标注和 G3 计划闸门通过、费用确认后，才各提交一次；不增加 seed 或重复次数掩盖差异。
- 生成后用同一事件表逐帧/正常速复核，并报告“标签效应”“提示词语义效应”“provider mode 差异”能否区分。
- 若两组请求最终使用同一 `reference2video` mode，仍可比较任务标签语义；报告中须明确这是 Ref2VA prompt-task A/B，不得归因于 API mode 差异。
