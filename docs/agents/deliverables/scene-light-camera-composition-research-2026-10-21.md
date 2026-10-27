# 场景光影、镜头与构图 Prompt：GitHub 检索记录

检索日期：2026-10-21。通过 GitHub API 阅读公开源文件与许可；没有安装或执行上游 skill，没有修改产品代码，没有进行出图质量对比。以下适用性判断是设计建议，不是模型效果证明。

## Observed — 仓库与源文件事实

| 来源 | 固定版本 | 已读材料 | 可参考内容 | 许可 |
| --- | --- | --- | --- | --- |
| ddcat-ai/open-ai-canvas | 9fdebd07841b71caf4fa5e116b8a3b8af3a959ea | 光影/构图方法卡、色彩与用光方法、camera-prompt-library.ts、lighting/camera dialog | 光源合理性、资产本色与受光分离、8 个相机/8 个镜头配置、11 档焦距、10 档光圈、8 个光影预设及参数编译 | 仓库 MIT，复用时保留来源与许可 |
| smixs/visual-skills | 92be33a5a73325fb3d8e0c73b22744b114e2a90e | camera-lighting-vocabulary.md、prompt-framework.md、portrait-cinema.md | 景别/镜头/光源/方向/光质独立词汇，参数化模板，术语附带可见效果 | CC BY 4.0，需署名 |
| OSideMedia/higgsfield-ai-prompt-skill | 70754977d1884794963ac0a748eaaa85b6e9c82a | higgsfield-image-shots/SKILL.md | 静态图 10 类取景、10 类角度、Prompt 例句；有无参考图两种用法 | 仓库 MIT |
| patipanpealt/alt-cinematography-reference | 97eee30c93fa659c70a5645e13269a008dd9e3d0 | README.md、content.json | 10 类景别、10 类角度、12 类灯光条目、9 类构图/连续性条目 | GitHub license API 返回 404；不直接复制文字和素材 |
| freestylefly/awesome-gpt-image-2 | 63e6176fa01be51c000108dacd72716d3e46784b | docs/templates.md 的建筑与空间、摄影与写实段，LICENSE | 空间用途/材质/动线/环境/相机/照明的完整模板及 JSON 示例 | 仓库 MIT；案例和第三方素材来源需逐项记录 |

固定来源入口：

- [open-ai-canvas 光影方法](https://github.com/ddcat-ai/open-ai-canvas/blob/9fdebd07841b71caf4fa5e116b8a3b8af3a959ea/backend/builtin/视觉基调设计/cards/ctp-lighting.md)
- [open-ai-canvas 构图方法](https://github.com/ddcat-ai/open-ai-canvas/blob/9fdebd07841b71caf4fa5e116b8a3b8af3a959ea/backend/builtin/视觉基调设计/cards/ctp-composition.md)
- [open-ai-canvas 色彩与用光](https://github.com/ddcat-ai/open-ai-canvas/blob/9fdebd07841b71caf4fa5e116b8a3b8af3a959ea/backend/builtin/影策短剧制作工作流/references/methods/color-and-light.md)
- [open-ai-canvas 镜头参数编译](https://github.com/ddcat-ai/open-ai-canvas/blob/9fdebd07841b71caf4fa5e116b8a3b8af3a959ea/web/src/lib/canvas/camera-prompt-library.ts)
- [visual-skills 摄影词汇](https://github.com/smixs/visual-skills/blob/92be33a5a73325fb3d8e0c73b22744b114e2a90e/video/references/camera-lighting-vocabulary.md)
- [visual-skills 模板框架](https://github.com/smixs/visual-skills/blob/92be33a5a73325fb3d8e0c73b22744b114e2a90e/image/references/prompt-framework.md)
- [Higgsfield 静态图取景](https://github.com/OSideMedia/higgsfield-ai-prompt-skill/blob/70754977d1884794963ac0a748eaaa85b6e9c82a/skills/higgsfield-image-shots/SKILL.md)
- [ALT 分类数据](https://github.com/patipanpealt/alt-cinematography-reference/blob/97eee30c93fa659c70a5645e13269a008dd9e3d0/content.json)
- [GPT Image 建筑与空间模板](https://github.com/freestylefly/awesome-gpt-image-2/blob/63e6176fa01be51c000108dacd72716d3e46784b/docs/templates.md#tpl-architecture)

## Direct implication — 对当前产品的直接启示

1. 光影、镜头、构图在这些来源中有独立字段/词汇。可分别组织选择面板，再编译成同一份场景 Prompt。
2. 相机型号、镜头风格、焦距、光圈属于不同维度；上游相机配置包含高光柔化、肤色等审美词，不适合默认全量叠加。
3. ALT 的 9 类构图条目中，180°、30°规则属于跨镜头连续性，当前静态场景只取其余 7 类；动态运镜、声音、动作时序继续留在分镜设计。
4. open-ai-canvas 色彩与用光文档明确分开资产本色、环境受光和最终观感；换机位不移动世界中的窗/灯等光源。可作为后续图像编辑与 media 的交接边界。
5. ALT 缺少可确认的复用许可，当前只用作分类比较；不能将“公开可见”当作允许复制。

## 建议的第一批面板内容（尚未实施）

- 光影：侧窗漫射、阴天柔光、晴日硬光、清晨侧光、日落低角度光、蓝调时刻、月夜环境光、烛火/灯笼、室内实用灯、霓虹混合光。它们是可选方案，不是自动附加风格。
- 镜头：环境全景、空间中景、局部细节；平视、俯视、仰视、顶视；广角/标准/长焦观感；深景深/浅景深。景别、角度、焦距、景深分别选择，不互相捆绑。
- 构图：居中对称、三分、引导线、框中框、前中后景层次、留白、黄金比例。面向无人场景时用建筑、门窗、通道和景物作锚点，不凭空加入人物。

建议字段：

```text
场景：空间类型、固定布局、材质、关键物体
光影：时间、光源、位置/方向、软硬、补光、反差、光色
镜头：景别、机位高度、朝向、焦距观感、景深、对焦目标
构图：主体锚点及位置、前中后景、引导关系、留白
保留项：本次需要保持的布局、物体、材质和光源位置
```

各字段只输出用户实际选择的内容。完整 Prompt 模板可提供以上各模块的组合，但保留单项编辑能力。光影修改和镜头修改应分别说明本次允许变更的范围。

原创示例（并非上游原文，也不是效果实测）：

```text
场景：[宋代客栈大堂]，固定空间布局与物件由场景设计提供。
光影：[午后自然光]由[画面左侧已有木窗]进入；[柔和漫射]，暗部保留木构与桌椅纹理。
镜头：[平视环境全景]，[24mm 广角观感]；[深景深]，前中后景均可辨认。
构图：[中央通道作为引导线]，以[后方楼梯]为视觉锚点；桌椅形成前景，主通道为中景，楼梯与廊道为后景。
```

## Not yet proven / Hypotheses

- 仓库存在上述词汇和编译函数，不证明目标图像模型会严格遵守焦距、光圈、方位或空间关系。
- 某来源称 Nano Banana 忽略数值、GPT Image 支持特定表达，属于上游作者经验，不是本项目已验证的模型契约。
- 将参数附加“可见效果”描述可能有助于可控性，但需实际模型 A/B 测试。
- “JSON 格式更真实”“更多参数效果更好”均未被本次检索证明。

## What would verify it

在固定模型、同一场景和相同参考素材下，分别只改变一个光影/镜头/构图字段，核对布局保留、阴影方向、材质本色、视角、景深与视觉锚点。media Blender 的几何/深度验证与图像模型对 Prompt 的遵循度分开验收。
