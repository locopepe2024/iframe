# GreenA 多泳道剪辑与字幕 v1

状态：实施中；本文件整合 2026-09-21 Assembly 两份合同及 2026-10-15 timeline editing。现有源音轨实现优先于旧文档中 video-only 描述。

## 事实与选型边界

Observed：已有 AssemblyEditPlan、owner/revision 校验、项目/系列 API 和 FFmpeg 渲染；当前独立音频轨被拒绝。默认草案固定 60 秒且可能隐式变速；字幕导出代码仍有 TODO。

已有资料明确分析 FunClip/FunASR：适合作为转录/时间戳适配器，不能替代编辑计划。尚未找到其他 Web 剪辑器的完整选型记录。

候选待核验：OpenCut、OpenVideo、DesignCombo、Remotion。它们的当前许可证、固定 revision、React/Next 兼容性、时间线交互、字幕预览与服务端导出一致性均需源码核验；本 spec 不声称其可直接商用或已集成。不复制未核验代码，不引入第二套持久化项目模型。选型评估应记录仓库 URL、SHA、许可证及依赖许可证、可复用模块、构建结果和最小适配实验；优先复用交互层，通过适配器读写 AssemblyEditPlan。

## 目标及范围

同一时间尺显示视频、对白、BGM、SFX、字幕泳道；支持添加/删除泳道、mute、片段定位/裁切/分割/删除、吸附、撤销/重做与显式保存。主视频保持连续拼接；多个视频泳道可顺序交错放置，但全局重叠需拒绝，画中画/视频叠层另立合同。音频泳道可显式重叠混音。字幕与配音独立，默认无烧录。

## 持久化合同

- 沿用毫秒半开区间、稳定项目/帧/task 身份、revision 乐观锁和 owner 边界。
- `AssemblyLane.kind` 新增 `subtitle`；`muted=false`。不渲染 muted 轨道。现有计划缺字段保持兼容。
- 字幕片段使用 `text`（纯文本、非空、上限 2000 字符），不要求媒体路径；时间范围必须在计划内。同轨字幕不重叠；不同字幕轨允许重叠以支持语言版本，导出明确选轨。文本不解释为 HTML、ASS 或 FFmpeg 命令。
- 独立音频必须由拥有者可访问的稳定 media_id 或项目/帧音频字段解析，拒绝任意本地路径和外部 URL。ASR 结果只形成可编辑草稿，不覆盖人工字幕。
- 视频默认原速：timeline duration 等于 source out-in；变速必须显式。实际源长度由 FFprobe 校验。
- 字幕导出独立 SRT（UTF-8、CRLF、毫秒时间码）；字幕预览按播放头显示选轨的有效 cue。SRT 禁止内嵌空行/伪造 cue 分隔及控制字符。
- 后续导出模式 `none / sidecar / burn_in`；burn_in 使用受控字体与样式，验证 libass/中文字体存在后开放。禁用或静音字幕不得导出。
- 混音以视频时间线为基准：atrim、asetpts、增益、adelay、amix，缺尾补静音，输出截到目标长度；不隐式循环音乐。原视频音轨与独立对白允许分别静音，避免双声。

## 实施切片与验收

1. 合同与字幕 sidecar：模型/TS 类型、纯文本字幕序列化、owner-scoped 项目/系列 SRT 导出；验证旧计划、重叠/越界、恶意文本、静音、排序和权限。未支持的字幕渲染明确报错。
2. 时间线编辑：现有 UI 提升为多泳道，字幕添加/修改/预览/导出；原速草案、裁切、拆分、连续排列、撤销。运行 typecheck、Vitest、build。
3. 音轨解析与混音：owner-local 素材解析、音频上传引用、音轨 mute/gain/offset 与多轨导出；合成音频检测前后偏移和有效频率，异主拒绝。
4. 字幕烧录及实际导出：英文/中文/换行样本、字体能力预检、验证目标帧字幕区域变化；记录输入 revision、输出 probe 与失败状态。
5. GreenA 发布验收：固定实际运行源码与增量来源，保留媒体与配置，适配 `/srv/iframe-nsfw`；记录镜像与回滚版本。不得使用面向 lumenx 的 release helper 原样发布。

验证：pytest assembly 合同与编译器、字幕模型/序列化/API；前端 typecheck/定向 Vitest/build；真实 FFmpeg 合成素材验证切点、声音、字幕及输出时长。单元测试通过不能代替部署验收。

## 明确待办

浏览器成熟编辑器选型需补固定版本源码证据；多视频叠层、转场、自动 ASR、自动音乐闪避不计入首片。保存不启动渲染或付费任务；所有生成及字幕识别需独立显式操作。

## GitHub 元数据初核（2026-10-27）

通过 `gh api repos/...` 只读检查：OpenCut-app/OpenCut 的 GitHub license 字段为 MIT；remotion-dev/remotion 为 NOASSERTION；designcombo/react-video-editor 重定向到 openvideodev/react-video-editor，字段为 NOASSERTION。三个仓库均未归档。上述仅是仓库元数据，不能代替固定 SHA 的许可证正文、依赖和适配能力审查。

首片进度：已实现 subtitle 泳道及纯文本合同、muted 字段、项目/系列 owner-scoped SRT 下载，旧渲染路径明确拒绝尚未支持的字幕轨。音频混音、编辑 UI 和烧录仍待实施。
