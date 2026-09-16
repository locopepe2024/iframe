# MiniMax H3 模式化提示词编写

适用：用户明确要求为 MiniMax/H3 编写或优化视频提示词，或请求分析 H3 IR。依据官方 MiniMax-AI/MiniMax-H3 的 h3-prompt-writing 及 base-en/ref-en 指南，版本 d21241f0a4b3acbb34c97dae47fa417b7065e438。以下为 LumenX 独立整理的操作指导，不是执行官方托管 IR，也不赋予生成权限。

## 先确定素材用途，再决定模式

- T2VA：无关键帧，按文本建立视听时间线。
- I2VA：图片就是 0 秒实际首帧，保留画面锚点并向后发展。
- FL2VA：两图是实际首尾帧，描述连续变化路径并在片尾落到尾帧；默认单镜头，除非用户指定切镜。
- L2VA：图片是实际尾帧，从合理前态发展并在末尾到达它。创作语义不代表当前 UniArt SKU 已开放该模式。
- Ref2VA：参考人物、服装、环境、动作、风格、运镜或声音，不要求将图片直接作为首帧。一张拼接人物图也可以是 Ref2VA；不能因为只有一张图片就强制按 I2VA 写作。只借用视频运镜不等于编辑原视频，只借声音音色不等于复用原始台词。

若素材用途与用户选择的模式矛盾，指出差异并建议匹配的创作模式，不自动改提交参数。不要从官方模型总能力推断 UniArt 当前 SKU 的能力。

## 基础／关键帧输出

T2VA 从三个字段开始，固定顺序：integrated_multimodal_description、overall_soundscape、non_diegetic_music。

关键帧模式先写一行对齐说明，空行后再写这三个字段。I2VA 说明 <Picture 1> 在 0.00 秒属于 [Shot 1] 并作为实际首帧；FL2VA 说明 Picture 1 对齐 0.00 秒、Picture 2 对齐最后 [Shot N] 的总时长 S.SS 秒；L2VA 说明 <Picture 1> 对齐最后 [Shot N] 的 S.SS 秒。S.SS 为用户总时长且保留两位小数。关键帧模式不能误用全参考六段模板。

## 全参考输出

固定六个字段，顺序如下：
1. subject_definitions：逐行定义需要追踪的参考内容和来源。
2. summary：以方括号内任务关系开头，简述目标；如 reference generation、keyframe completion、video editing、video continuation、audio reference、audio reuse，只选实际成立者。
3. retention_analysis：按定义的用途说明保留、转移或复用策略及出现镜头。
4. detailed_description：按播放顺序描述实际可见、可听的全过程。
5. overall_soundscape：全片环境与物理声音。
6. non_diegetic_music：仅观众能听见的配乐。

<Subject N> 指可复用内容单位，不等于文件：人物、服装、道具、环境甚至动作都可以是主体。同一主体可以来自多份素材，一份素材也可以定义多个主体。<Picture N>、<Video N>、<Audio N> 各自按类别编号；不得把 LumenX 跨类型的 @N 直接当作同号 <Video N>。从本轮附件实际类型和顺序建立明确对应。

若图片仅提供身份，在主体定义中注明来自 <Picture 1> 即可，不必额外定义独立图片条目；图片作为首帧、尾帧、关键帧、构图或分镜锚点时才单独分析其作用。视频标签用于原视频编辑、续写或时间结构参考；视频里的可复用人物仍定义为主体。同步视频音轨只有实际被提供并启用时才能定义为音频来源，不凭空添加音轨。

视觉参考关系：fully_preserved、partially_preserved、attribute_transfer、weak_reference。音频关系：fully_copy、partially_copy、reference、weak_reference。按已定义的参考用途判断：只参考身份时，新背景或动作不自动意味着身份部分丢失；明确把原服装纳入主体定义又要求换装时，应说明改了哪些特征。这是目标策略，不是成片检测结果。

## 镜头、声音、语言与验收

官方模型提示词的结构正文用英文；对白、歌词、可见文字保留原语言。用户明确只要中文时按其要求输出中文稿，不声称它是严格官方英文格式。解释与交流可用中文。

[Shot 1] 不附切镜时间戳；后续真实切镜按 [Shot N] At MM:SS.mmm, ... 书写，切点严格递增且在片长内。一个连续镜头可包含多个动作阶段，但不能因此增加 Shot 数量。最后一镜明确延续到用户总时长；最后切点不等于片长。

每镜写清构图、主体可见特征与位置、环境光线、动作状态变化、相机运动、当前声音以及参考内容生效的时刻。运镜描述运动类型、必要的幅度与速度。Ref2VA 的 detailed_description 官方建议通常约350–500英文词，但不能为凑长度增加剧情；现有输入上限属于产品／接口约束，不可声称长稿一定能直接提交。

发声者才分配稳定 (S1)、(S2)，跨镜不重编号；<Subject N> 与说话人编号不是同一个体系。对白用 <d>[Language] 原台词</d>；跨切镜对白使用 <scenetrans> 且说明持续，片尾截断使用 <cutoff>。仅参考音色时不能把参考音频的原台词带入新片。无对白请求不生成对白或说话人标签。

现场音乐属于镜头内声音；角色听不到的配乐才放 non_diegetic_music。overall_soundscape 只在要求全片完全静音时用 N/A；non_diegetic_music 无配乐时用 N/A。不要把所有音乐都当成后期配乐。

最后对照当前原稿核验身份、造型、场景、剧情、时长、画幅、镜头数量与禁用项，检查双手／支撑腿／道具占用和运镜相对关系。仅允许用户授权的改编。对比 IR 时先确认输入是不是同一个故事；不得用结构更精细掩盖输入错配。
