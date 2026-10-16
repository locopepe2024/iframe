# s09 H3 Ref2VA A/B 结果复核 v1

日期：2026-10-16。范围：A/B 各一次付费生成；本记录是首轮稀疏帧和媒体元数据复核，不是最终逐帧验收。

## Inputs and provider results

| 组 | 任务语义 | task ID | 输出 | 输出媒体观察 |
|---|---|---|---|---|
| A | `[reference generation]` | `task_XHcJxYAIS1wn6Zl7gBlKiHSEShMbtDps` | `s09-label-ab-A-replacement.mp4` | 1344x768，24 fps，90 视频帧，容器约 3.750 s |
| B | `[video editing]` | `task_RGQGiGDm44aTdXtS1fEADsApMyPjWlJh` | `s09-label-ab-B-replacement.mp4` | 1344x768，24 fps，90 视频帧，容器约 3.750 s |

两组请求固定同一源视频 SHA-256、人物图 SHA-256、`reference2video`、`minimax-h3-vip`、720p、16:9、静音和 seed `20261011`。输出时长短于请求的 4 秒；这属于 provider 运行观察，不能把它当成动作时间线改善。

## Observed

- A 稀疏联系表中主要人物呈现长黑发/黑色裙装的源片人物形象，未明显呈现 `<Picture 1>` 的银发、眼镜和黑色中式外套身份。身份替换首轮不通过。
- B 稀疏联系表中主要人物更接近 `<Picture 1>` 的银发、眼镜和黑色服装，身份迁移相对 A 更成功；这只是首轮样本的视觉观察，不形成成功率结论。
- A 在抽样帧中出现长杆横向运动、抬杆和前方展开候选，但尚未逐帧确认 E2 深俯身、E4a/E4b/E4c 三事件是否完整存在。
- B 抽样中可见深俯身、回升/抬杆及红缨运动候选，但红缨在部分帧出现明显放大/拖影，枪杆与红缨几何不能判定通过。
- B 密集联系表进一步显示：同一长杆的两端在多个连续帧都呈现武器端/红缨端，出现双枪头（或双端武器）外观；这不是单帧运动模糊可解释的孤立像素。枪械几何失败。
- 两组输出均约 3.75 秒，源片请求中的 3.733 秒硬切未能仅凭首轮联系表确认；输出最后约 0.25 秒的切后低姿态需要逐帧查看。

## Direct implication

- B 相比 A 在人物身份维度有可观察改善候选；不能归因于 `[video editing]` 标签，因为两份 prompt 同时改变了主体定义、保留关系和动词。
- B 的人物身份改善伴随明显的道具结构错误；不能用身份改善抵消双枪头失败。
- 当前两组都不能判定动作时间线通过。输出时长差异和 provider 的 24 fps 重采样必须先纳入时间映射，再比较 E2–E5。
- 背景和 UI 杂质需要独立评估；整帧输出不是原像素合成结果。

## Event review status

| 事件 | A | B | 说明 |
|---|---|---|---|
| E2 深俯身 | `unscorable` | `candidate` | 当前仅稀疏帧，未完成连续窗口复核 |
| E3 回升 | `candidate` | `candidate` | 需正常速和逐帧确认 |
| E4a 第一次高举 | `candidate` | `candidate` | 需与 69–73 源窗配对 |
| E4b 回落/转背 | `unscorable` | `candidate` | 需确认是否夹在两次高举之间 |
| E4c 第二次高举 | `unscorable` | `candidate` | 不能把一次高举代替两次 |
| E5 前方展开 | `candidate` | `candidate` | 枪尖、枪尾、握点仍未通过 |
| C1 帧 112 硬切 | `unscorable` | `unscorable` | 输出 3.75 秒，需逐帧寻找对应切换 |

## Not yet proven / Hypotheses

- B 的身份改善是否来自 `[video editing]`，或来自主体/保留关系重写：未区分。
- `[video editing]` 是否改善动作相位、枪几何或背景保真：未证明。
- B 的双枪头是否由提示词未定义“单一枪头/枪尾”导致：可能，但未做单变量验证。
- 两组是否真正复现源片的两次高举和中间回落：未证明。

## What would verify it

1. 对 A/B 每 3–4 帧抽取一张连续联系表，覆盖输出 0–3.75 秒，并单独放大 2.0–3.2 秒。
2. 用源时间 `frame/30` 与输出时间 `frame/24` 对齐 E2–E5；先判 `equivalent / absent / unscorable`，再判时点。
3. 检查输出帧 80–89 附近是否有独立硬切或仅为视角变化；不得把末尾截断误判为源切点复刻。
4. 对人物、枪杆、红缨、背景和 UI 分开给出结论；本轮不扩增 seed 或重复生成。

## Prop correction for a future controlled trial

**勘误（2026-10-17）：下述 B2 候选的端部定义写反，已撤回作为有效几何修订。** 源帧 65、69、75、87 放大复核显示红缨跟随同一活动端，另一端呈素杆；B2 却把红缨写在钝杆端、金属枪尖写在对侧。枪尖金属细节在部分运动帧模糊，后续提示词应只写源帧可确认的“单杆、单红缨端、对侧素杆端”，必要时另以清晰帧核定枪尖形状。

错误端部定义所在的 [B2 历史 prompt](../raw/2026-10-11-qiangfa-cut-poc/qiangfa2-gray-full/s09-label-ab-video-editing-prop-b2.md)保留供失败追溯，不再作为下一轮生成输入。

## B2 follow-up observation

- B2 task `task_n6Rrfh2cSce0A6LzAr76YtL242yA2LNE` completed with output `s09-label-ab-B2-replacement.mp4` (`ab20e12b700621edbe3c017d27b1029c1e076fabe920fcfbe4f66ad6c503b87d`). Media is again 1344x768, 24 fps, 90 frames, approximately 3.750 s.
- The dense contact sheet no longer shows the same persistent two-metal-tip appearance seen in B; the single shaft is more often visually continuous. However, both ends still have unstable red/tassel-like blobs in parts of the sequence, so spearhead/blunt-end geometry is not approved.
- B2 largely reverts to the source performer appearance (long dark hair/skirt silhouette) and does not retain B's observed silver-haired, glasses identity improvement. This is a regression in identity, not an overall pass. B2 prompt 同时含有与源帧不符的端部约束，不能把身份回退解释为“几何约束与身份竞争”的证据。

**B2 status:** `prop_geometry: needs_correction`; `identity: regression`; `motion_timeline: unscored`; `prompt_source_consistency: failed`。单次样本无法判定失败由端部矛盾、提示词长度或模型随机性中的哪一项造成。
