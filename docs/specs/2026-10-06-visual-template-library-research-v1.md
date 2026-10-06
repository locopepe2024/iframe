# 视觉模板与导演技能素材库调研 v1

## 状态

这是需求收集和外部项目调研文档，不是实现授权。当前目标是收集可复用的公开项目和设计模式，后续再建立 iframe 自有的模板与技能系统。

调研日期：2026-10-06

## 当前需求材料

### A. 国风动漫 / 仙侠视觉方向

需求材料描述了以下视觉方向：

- 中国古典美学：汉服长袍、飘逸丝带、玉饰、叠层袖；
- 仙侠场景：云雾山峦、亭台楼阁、寺庙庭院、花瓣和朦胧山谷；
- 水墨色彩：翡翠绿、朱红、金色与柔和水墨渐变结合；
- 工笔线描：面部、长袍和饰品保持精细线条；
- 题材方向：仙侠修真、武侠英雄、历史宫廷、天宫仙界；
- 画幅和阅读：适配 9:16 竖屏条漫；
- 动作主题：突破、宗门对决、飞剑战斗。

这些内容目前只能作为视觉模板候选。外部产品宣传中提到的自动识别、背景分层或条漫气泡布局，尚不能视为 iframe 已有能力。

### B. 半写实国风武侠角色设定

第二组材料提供了更适合作为角色基础模板的约束：

- 真人比例、修长身材、结构清楚的四肢和手部；
- 东方女性面孔，精致但不过度夸张；
- 半写实游戏角色设定图，而非传统二维日漫；
- 汉服叠穿、宽袖、腰封、绳结、护腕和实用鞋履；
- 丝绸、皮革、金属、绳结分别表现材质；
- 灰白、青灰、墨黑为主，少量暖金或棕色点缀；
- 中性灰黑渐变背景，角色、武器和服装结构清晰可见；
- 动作可以有腾跃、扭转、重心变化，但基础身份不应被单一动作锁定。

其中的 `STYLE FOUNDATION`、`CHARACTER DESIGN`、`CHARACTER VARIATION TEMPLATE` 和 `NEGATIVE PROMPT` 可作为后续模板字段设计的样例。不能直接把整段文字作为不可编辑的永久提示词。

### C. 胡金铨式导演视觉方向

作为导演风格候选，材料中可抽取：

- 古典东方构图和框景；
- 门框、廊柱、窗棂等空间遮挡；
- 留白、等待、停顿和突然爆发；
- 庭院、山林和建筑形成明确纵深；
- 克制、清晰、有站位关系的武打；
- 飘带、衣袖、竹叶、雪雨作为运动线索；
- 暗红、墨黑、灰青、土金等低饱和色彩；
- 自然光、空间阴影和仪式感动作。

这类内容应属于导演风格模板，不应写进角色基础身份。

## 模板边界

结合现有 iframe spec，模板应分为三类：

| 类别 | 负责内容 | 当前归属 |
| --- | --- | --- |
| 导演风格模板 | 构图、光线、色彩、空间、镜头节奏、武打语言 | Director / 项目或系列视觉配置 |
| 角色模板 | 比例、面部、服装、材质、配色、武器和角色设定图约束 | Image Editor 的角色设计模板 |
| 动作模板 | 起始状态、触发原因、动作过程、结束状态、情绪目的、重心变化 | Image Editor 或 3D Director；视频分镜负责最终执行 |

角色工作台只负责人物、时代变体、造型确认和连续性。图片编辑器负责模板选择、提示词编辑和候选生成。动作、镜头和场景不会静默写入基础角色身份。

现有边界依据：

- `2026-10-05-character-workbench-image-editor-boundary-v1.md`
- `2026-10-03-character-identity-skill-v1.md`
- `2026-09-23-director-action-structure-agent-v1.md`
- `2026-10-03-digital-avatar-character-design-board-v1.md`

## GitHub 公开项目检索

以下结果通过 GitHub 公共仓库元数据和公开文档检索得到，时间为 2026-10-06。仓库存在相关代码或文档，不等于其生成效果、生产稳定性或线上部署已经验证。

### 1. 创作流程与导演技能

| 项目 | 公开信息 | 可借鉴方向 | 限制 |
| --- | --- | --- | --- |
| [zenstory-ai/drama-skills](https://github.com/zenstory-ai/drama-skills) | MIT；剧本、角色资产、分镜、图片/视频提示词、审查；2525 stars | 阶段化 artifact、生产前确认、连续性检查 | 不直接复制其提示词和流程文案 |
| [kangarooking/director-skills](https://github.com/kangarooking/director-skills) | MIT；AI 视频导演技能；171 stars | 按动作、摄影、资产和类型拆分知识 | 需逐项检查技能的实际输入输出 |
| [62656456/ai-film-skills](https://github.com/62656456/ai-film-skills) | Apache-2.0；21 个电影技能模块，含故事、导演、资产、3D 预演；58 stars | 能力目录、普通/实验能力分级、资产与导演分层 | 不能把模块说明当成效果证明 |
| [Coconah/AI-Short-Drama-Agent-Skill](https://github.com/Coconah/AI-Short-Drama-Agent-Skill) | 短剧编剧 Agent SOP；无声明许可证；19 stars | 阶段顺序和上下文交接 | 未声明许可证，不复制代码或文案 |
| [HBAI-Ltd/Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app) | MIT；画布、Agent、图像/视频、智能分镜和 3D 预演；16492 stars | `source → draft → execution`，技能与工具分层 | 不把其画布模型直接引入 Studio |
| [waooAI/waoowaoo](https://github.com/waooAI/waoowaoo) | 工业化 AI 影视生产平台；许可证为 NOASSERTION；14365 stars | 资源版本、任务检查点、输入输出 lineage | 许可证和可复用边界需单独审查 |
| [xxx-888/super_gen](https://github.com/xxx-888/super_gen) | AI 短剧平台，含剧本解析、分镜、@ 引用、H3 多模态参考和剪辑；无声明许可证；19 stars | 检查其分镜与引用交互 | 不复制实现；需审查许可证和代码质量 |

### 2. 角色一致性、姿态和动态参考

| 项目 | 公开信息 | 可借鉴方向 | 限制 |
| --- | --- | --- | --- |
| [cubiq/ComfyUI_IPAdapter_plus](https://github.com/cubiq/ComfyUI_IPAdapter_plus) | GPL-3.0；角色/图像参考适配；6139 stars | 参考图角色一致性、风格与身份权重的概念 | GPL-3.0，不能直接复制到 iframe 闭源产品 |
| [Fannovel16/comfyui_controlnet_aux](https://github.com/Fannovel16/comfyui_controlnet_aux) | Apache-2.0；ControlNet 辅助预处理器；4209 stars | 姿态、边缘、深度、线稿等参考输入类型 | 需要独立评估模型和运行环境，不等于 iframe 能力 |
| [Kosinkadink/ComfyUI-AnimateDiff-Evolved](https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved) | Apache-2.0；AnimateDiff 工作流；3551 stars | 动态参考和动作候选的工作流概念 | 不能把其节点结果直接当作 3D 导演台版本化数据 |
| [lllyasviel/ControlNet](https://github.com/lllyasviel/ControlNet) | Apache-2.0；扩散模型控制；34122 stars | 姿态、深度、边缘等控制信号的分类 | 需要模型、权重和推理链路验证 |

### 已核对的具体文件入口

- [`ai-film-skills/skills/wuxia-design/SKILL.md`](https://github.com/62656456/ai-film-skills/blob/main/skills/wuxia-design/SKILL.md)：将摄影、光色、空间、动作、材质和连续性分开，并提供 `style_module` / `style_route` 的结构化交接。它明确要求类型预设不覆盖用户故事、已锁摄影或资产。
- [`director-skills/action-fight-prompt/SKILL.md`](https://github.com/kangarooking/director-skills/blob/main/action-fight-prompt/SKILL.md)：给出时间分段、动作因果、环境反馈、参考图映射和音效层。其固定时长比例、每段必须有环境反馈等规则属于该技能的方法，不应成为 iframe 的全局硬约束。
- [`drama-skills/skills/short-drama-assets/SKILL.md`](https://github.com/zenstory-ai/drama-skills/blob/main/skills/short-drama-assets/SKILL.md)：明确区分身份、造型变体、镜头瞬态和故事语义。服装、伤势、天气属于状态或变体，姿势、视线、站位与相机角度归分镜。这与 iframe 已讨论的角色一致性边界直接相关。
- [`comfyui_controlnet_aux/node_wrappers`](https://github.com/Fannovel16/comfyui_controlnet_aux/tree/main/node_wrappers)：仓库有实际预处理节点目录和测试，适合研究姿态/深度输入格式，不能据此推断当前 iframe provider 会消费这些信号。

优先级：先读 `wuxia-design` 与 `short-drama-assets` 的字段和交接规则，再读 `action-fight-prompt` 的时序结构；ComfyUI/ControlNet 作为后续参考控制能力调研，不进入第一版纯文本模板实现。

## 暂不引入的内容

- 不直接引入 GPL-3.0 的 IPAdapter 实现；
- 不把外部仓库的提示词原文作为 iframe 生产资产；
- 不把 ComfyUI 节点工作流误认为已完成的图片编辑或 3D 导演台能力；
- 不在角色工作台中加入动作、镜头和场景模板；
- 不让模板自动选择模型、SKU、比例、参考图或提交生成任务。

## 后续研究计划

1. 逐个读取 MIT / Apache-2.0 项目的 README、目录和核心 schema，记录可复用的数据结构。
2. 为导演风格、角色造型、动作表演建立 iframe 自有字段草案。
3. 先在图片编辑器实现模板预览和可编辑 prompt，不接自动生成。
4. 为每个模板记录 `template_id`、`version`、`category`、`required_references`、`editable_fields`、`prompt_builder`、`source` 和 `review_state`。
5. 3D 导演台完成深度、占位和机位能力后，再把动作模板与版本化 motion reference 对接。

## 证据强度

- **代码事实**：本仓库已有角色工作台、图片编辑边界和 3D 动作结构 spec。
- **外部项目事实**：上表的仓库元数据、许可证和公开定位可通过 GitHub API 核对。
- **直接推论**：外部项目适合借鉴阶段交接、模板分类、参考图控制和资源 lineage。
- **尚未证明**：任何外部项目的模型效果、线上稳定性和与 iframe 当前 provider 的兼容性。
