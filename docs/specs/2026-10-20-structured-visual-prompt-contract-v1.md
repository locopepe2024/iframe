# iFrame 结构化视觉提示词规范 v1

状态：研究与设计提案，尚未实现统一运行时。日期：2026-10-20。
范围：角色、场景、道具、分镜。目标：面板、AI 完善、保存版本、最终生成输入共享明确的字段归属，防止后续拼接覆盖用户选择。

## 证据与边界

- 官方资料事实：OpenAI Structured Outputs 约束符合 JSON Schema 的输出，但内容仍可能错误。strict 模式使用其支持的 Schema 子集；required、additionalProperties:false、拒绝/截断处理须按 provider 能力实现，不能仅由兼容接口名称推定支持。
- 官方资料事实：Gemini 图像指南建议具体描述主体、环境、光线、机位；建议用正向描述表达预期场景，并提供语义负面约束建议。该建议不是其他模型的行为保证。
- 代码事实：frontend/src/lib/characterStructuredDesign.ts 已有 identity/look features；characterSectionText 将字段值以分号拼接，未输出分类标题。
- 代码事实：src/apps/comic_gen/character_prompts.py 的 build_character_image_prompt(full_body) 固定添加“概念设计”“高质量，杰作级细节”；headshot 也添加质量词。这是用户最终文本中相同词语的一个确定代码来源，不能把所有词归因于 AI 返回。
- 尚未证明：这些词单独导致了用户观察到的磨皮效果；需要控制模型、原图/参考、参数及其他文本的对照验证。JSON 序列化本身改善图像真实感亦未证明。
- 当前限制：896ef1d9 的自然肤质结果校正只覆盖返回摘要与 skin 字段，不覆盖下游固定模板和全部字段。不得宣称已端到端解决。

## 核心决策

面板字段/用户编辑是作者数据；AI 返回是可审阅提案；确认版本是生成基线；最终 Prompt 是编译产物。一个字段只能有一个当前值，不同时维护独立可写 JSON 与 prose 两份真相。

界面默认显示分类中文与字段值，JSON 供高级查看/导出。用户自由编辑文本时保存为显式 freeform_override；停止自动覆写其内容，提供明确的重新采用字段操作。不能靠正则反向解析任意自由文本承诺无损恢复字段。

JSON 是内部规范，不作为所有图片模型都支持的原生参数协议。模型适配层依据能力输出带标题自然语言、JSON 文本或独立负面参数；没有 negative_prompt API 能力时，把避雷项编译为提示中的明确约束，不发送虚构参数。

## 统一封套与归属

每份文档含 schema_version、kind(character/scene/prop/shot)、entity_id、revision、rendering、content、constraints、references、provenance。生成参数独立放 generation_config；画幅/分辨率/模型不混入服装或面容字段。

rendering 管理媒介（真人摄影/插画/三维等）、真实感与摄影意图；肤色和肤质归 character；布料与反光归衣物/道具材质。不可在多个层级设置互相矛盾的肤质。

content 使用按 kind 区分的类型；通用字段不得无限堆叠 mood/vibe/authenticity 等重复标签。未指定用 null/空数组表达，不等于“无”；明确无首饰/无道具必须有 none 值或明确约束。

provenance 按字段路径记录 script_fact、user_specified、confirmed_design、verified_reference、creative_choice 以及来源版本。来源和核对建议不编译进图片 Prompt。

references 使用当前 owner 可访问的资产 ID + 固定 revision + role；不把任意 URL 当可用身份参考，不把私有存储地址写入可分享规范。

## 四类内容

| 类型 | 固定设计字段 | 当前任务字段 |
| --- | --- | --- |
| 角色 | 年龄观感、面容（脸型/眉/眼/鼻/唇/眼周）、发型/发色、肤色/肤质、身高/体型、识别标记；服装方案、鞋履、首饰、装饰、兵器、新旧 | 资产展示姿态、正侧背/头像/全身、展示背景 |
| 场景 | 空间类型/尺度、布局、入口出口、建筑构件、地面、材质、固定陈设、地理方位锚点 | 时段、天气、灯光状态、镜头构图、可变陈设 |
| 道具 | 类型、轮廓、尺寸/比例、构件、材质、颜色、纹样/铭文、功能、识别点 | 开闭/完整破损状态、摆放/握持方式、展示视角 |
| 分镜 | 固定版本的角色/场景/道具引用 | 每角色表情/视线/动作/姿态/站位；景别、机位、镜头、构图、光线、交互、视频动作时间线 |

角色服装至少独立表示 inner、outer、bottom、footwear、layer_count、layering、fit、colors、materials、patterns、condition；首饰、发饰与手持道具独立。披帛/纱巾必须说明穿戴位置，不能因词典点击自动增加整件衣物。

场景摄影状态不改写固定空间；分镜情绪不改写角色脸型/肤色/体型；动作姿态不写回身份版本。角色资产默认的白底/中性表情/站立不得继承到叙事分镜。

## 角色示例（内容形状示意，非 provider 请求 Schema）

```json
{
  "schema_version": "iframe.visual.v1",
  "kind": "character",
  "entity_id": "suyan",
  "revision": 1,
  "rendering": {"medium": "photography", "intent": "真人写实角色资产"},
  "content": {
    "identity": {
      "face": {"shape": "圆脸"},
      "skin": {"tone": "自然米色", "texture": "保留可见的自然皮肤纹理"},
      "body": {"build": "肥胖体型", "posture": "肩背挺拔", "height_cm": null},
      "hair": null
    },
    "wardrobe": {
      "upper_layer_count": 2,
      "inner": "米白色素面交领里衣一件",
      "outer": "靛蓝色棉布交领长袍一件",
      "bottom": "浅灰色束脚长裤",
      "footwear": "素面布靴",
      "layering": "领口仅露一道里衣领缘；袖口不叠加装饰袖",
      "jewelry": null
    }
  },
  "constraints": {
    "must_keep": ["圆脸", "肥胖体型", "自然肤色与可见自然皮肤纹理", "上身仅里衣与外衣两件"],
    "avoid": ["未指定的中衣、披风、护甲或装饰性叠领", "皮肤磨平或塑料化"]
  },
  "references": [],
  "provenance": {"rendering.medium": {"source": "creative_choice", "requires_review": true}}
}
```

示例中的 photography 是提案，原始自然纹理本身不能推出用户已明确选择摄影；用户确认后才成为固定设计。不能因“肤质”二字就把动漫项目强制转换为摄影。用户示例的 porcelain skin finish / Smooth 与自然纹理目标应呈现为待核对冲突，不能自动混入。

## 编译与继承规则

1. 加载已确认且可访问的引用版本；收集显式用户选择与本任务字段。
2. 校验 schema、字段类型、枚举、长度、引用状态；校验语义冲突（摄影/动漫、磨皮/纹理、层数/服装件数）。格式正确不代表语义正确。
3. 固定身份沿引用继承；分镜仅覆盖当前表现/摄影状态。需要换装时显式选择衣装版本/任务覆盖，保留原身份版本。
4. 同字段冲突须给出具体差异供审阅，不通过拼接两段矛盾文本解决；AI 创意不能覆盖用户指定事实。
5. 以固定顺序生成：媒介 → 主体固定特征 → 服装/材质 → 当前表现/关系 → 环境 → 摄影构图 → 保留/排除约束。省略空字段，不添加泛化质量词。
6. 编译器只给资产图增加相应展示构图，不追加概念设计、磨皮、杰作级等隐式画风。原始用户明确要求艺术风格时予以保留。
7. 输出最终 Prompt 预览、来源 revision、compiler_version、内容 hash；生成任务使用用户确认的同一快照。中文优先，翻译按模型能力显式适配。

不以全局字符串删除修复语义：直接删除“磨皮”会破坏“不磨皮”，重复加护栏会造成冗余，也不能解释磨皮成因。禁止把肤质短语灌进每个服装/头发字段。

## 实施与验收计划

本轮只定义规范；不切换线上 Schema、不批量迁移旧项目、不触发付费生成。

第一阶段：修复现有角色模板的隐式概念/质量词；保留用户原文。测试三种资产构图及明确动漫风格保留。检查前后端实际拼接路径，验证最终生成快照而非只检查 system prompt。

第二阶段：建立版本化 Pydantic 主 Schema 和派生前端类型/JSON Schema；角色字典/面板到字段再到预览与保存闭环。兼容 identity/look.features 的旧版本，标记迁移来源；不把 legacy prose 伪装成已解析结构。

第三阶段：接入场景和道具，复用封套、引用、来源与编译约束；验证各域具体字段与状态分离。

第四阶段：优化分镜时接入动作/表情/姿态/视线词典及固定资产引用。此项按用户此前要求先记录，当前不扩展分镜 UI。

必要验收：面板到保存到重载到编译的 round-trip；AI 不覆盖用户字段；未指定与明确无的区别；固定 revision 可复现；最终 Prompt 无隐式概念/质量词；负面条件不反转；白底不泄漏到分镜；角色身份不会被镜头动作改写；过期响应/失效引用拒绝；旧数据仍可编辑。

图像质量验收独立：用户同意后，固定模型/尺寸/参考图/参数，比较原始文本、带标题文本、JSON 文本，采用多个样本；评价身份、肤质、层数、鞋履、场景关系，不把一张图或 schema 测试当统计证据。

## 参考资料（2026-10-20 获取）

- OpenAI Structured Outputs：https://platform.openai.com/docs/guides/structured-outputs （格式保障、Schema 子集、拒绝与内容错误边界）
- Google Gemini Image generation：https://ai.google.dev/gemini-api/docs/image-generation （Photorealistic scenes、机位、语义负面约束）
- OpenAI Images and vision：https://platform.openai.com/docs/guides/images （所取页面主要为视觉输入说明，不作为 JSON 出图质量优势证据）
