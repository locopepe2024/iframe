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

## 角色第一阶段实现（2026-10-20）

角色沿用 identity/look.features 兼容形状，schema_version 为 iframe.character-fields.v1；扩展独立 face_shape/eyebrows/eyes/eye_detail/nose/lips/makeup/skin_tone/skin_texture 与 footwear/jewelry/decoration/condition。旧 face/skin 是补充说明，旧 prose 不反向猜测字段。角色设计同一区域显示可编辑字段；词典面容/皮肤面板输出带标题的逐行文本并回传字段元数据，字段选择不调用模型。自由输入余文作为 supplemental_prompt 保存并展示，避免配置面容时丢失原来的服装或其他要求。

AI 请求显式传递 structured_identity/structured_look，服务端校验并将明确选择覆盖同键模型提案；确认版本保存相同字段，提示词由字段顺序编译。直接编辑结果全文将切回显式 notes 模式；直接修改输入全文清除旧字段，避免陈旧字段反过来覆盖作者修改。角色字段到 UI/确认/重载/最终 Prompt 已纳入自动测试。

此阶段没有实现四域统一封套、分镜继承运行时或全部服装细分属性；场景/道具/分镜沿此前实施顺序推进。图像一致性与肤质仍需真实出图验收。

词典配置本身也保存结构：dictionary_configurations 记录 preset_id、schema_version、source、preset_text、selections、resolved_fields、rendered_text。全部本地配置面板/模板都输出配置快照，不依赖从 Prompt 反解析；角色常用面板另映射到独立身份字段。服装模板的全部颜色、材质和鞋履选择可在配置快照中保存并送给 AI，但尚未全部提升为角色独立编辑字段。当前目录尚无不可变版本 ID，因此使用当次 preset_text/source 快照，不虚称已建立词典版本系统。同 preset_id 的最新配置替换当前配置记录；它是配置来源快照，不替代用户后来手动编辑的字段。自由文本更改后旧配置只能作来源记录，当前显式字段/current_draft 优先。

## 人像摄影企划参考补充（用户提供，2026-10-20）

来源：用户粘贴的人像摄影企划文章全文。未访问文中 X 链接，未独立验证作者实验。关于单张优于九宫格、特定词句改善相似度/互动的结论均为用户提供的经验，作为待验证假设；不作为模型通用能力保证。

### 参考素材用途必须显式选择

引用增加用途 role：identity_only、wardrobe、pose、scene、style、composition；并定义 preserve/replace 字段路径。identity_only 保留身份锚点，不继承原图背景、服装、道具、姿态和构图。它与当前“严格保持参考图中的角色外观、脸型、发型、肤色和服装”的全外观绑定不同，不能静默替换全局行为。角色母版/三视图可能需要 identity + wardrobe；写真换装可能只需 identity_only。以当前用户任务选择为准，未明确用途时不擅自假定换装。

同一画面有多人物时，每张参考图绑定明确 subject_id，避免把甲的面容或服装绑定到乙。identity_only 的锚点可包含脸型、五官比例、眉眼、肤色、年龄观感、发际线等；不得由参考照片推断不可见事实。发型是保持还是允许改动亦须逐项明确。

### 摄影企划字段归属

| 模块 | 所属数据与生命周期 | 约束 |
| --- | --- | --- |
| 身份保留 | character.identity + reference policy，固定设计版本 | 不用笼统“像本人”替代已有具体锚点 |
| 发型变量 | hair.length、bangs、color、structure；保留/允许变化分别定义 | 不默认把黑发改为棕黑，不强制加刘海 |
| 妆容、衣装、首饰 | look version 或整组拍摄 styling | 一组可统一，但不改写永久身份 |
| 重建场景 | scene revision + shot 状态 | 身份参考不隐式继承背景 |
| 表情、视线、动作、姿态 | shot.subjects[subject_id].performance | 不写回角色固定脸型/识别特征 |
| 构图、景别、机位、光线 | shot.camera / lighting | 不在身份字段中塞镜头要求 |
| 左右前后与交互 | shot.blocking / interactions | 坐标约定与身体归属必须明确 |
| 整组节奏与变化 | shoot_plan.shots，计划级 | 分镜表列出每镜差异，不能只追加“不重复” |
| 比例与结构限制 | shot.constraints，必要时计划级共用 | 指令不能保证解剖正确，结果仍需验收 |

### 交互结构示意（设计提案，非当前 API）

```json
{
  "subjects": [
    {"subject_id": "A", "character_revision": 3, "position": {"screen_side": "left", "depth": "foreground"}, "gaze": {"target": "offscreen_lower_left"}, "expression": "低头轻笑"},
    {"subject_id": "B", "character_revision": 2, "position": {"screen_side": "right", "depth": "behind_A"}, "gaze": {"target": "camera"}, "expression": "自然微笑"}
  ],
  "interactions": [
    {"actor": "B", "actor_body_part": "right_hand", "action": "rest_on", "target": "A", "target_body_part": "right_shoulder"}
  ],
  "coordinate_convention": "screen_side 按观众画面左右；身体左右按人物自身解剖左右",
  "constraints": {"avoid": ["肢体归属错误", "脸部融合", "手臂穿插"]}
}
```

视频另用时间点/动作区间描述起始、发展与结束；静态图只描述可见瞬间。主动方/回应方通过明确 actor/target/action 表达，避免再维护含义重复的情绪氛围标签。

### 整组拍摄计划

固定项：身份参考、选定造型、妆容方向、色彩与场景连续性。变化项：景别、视角、构图、表情、视线、姿态、互动关系。每镜显式指定变化，不随机改动固定身份。单张任务与最终拼版分别记录；九宫格预览不等于九个独立高质量资产。

去重仅能先检查计划字段相同或近似；实际图片是否重复另做人工/视觉评审。单张与多格效果需固定模型、参考、参数和样本数量对比，不能把“模型偷懒”当根因诊断。

### 默认值与冲突检查

“奶油肌/瓷肌/光滑”与“自然干燥纹理”可能冲突，作为具体用户选择核对；不能把文章里的少女妆默认用于所有年龄、性别和题材。不能默认改变肤色、发色、体型或五官来提升“审美”。“不要欧美化”不作为身份推断或全局负面词，改为保留用户选定的具体面部结构与肤色。

### 后续实施边界

本次记录参考用途、头发细分、计划与交互规范，不增加分镜 UI，遵守此前“等优化分镜时再加”约定。尚未实现 identity_only provider 编译、双人 blocking 或整组拍摄运行时；不得宣称已部署这些能力。优先下一步在参考素材面板显式区分身份/衣装/姿态用途，然后在分镜优化阶段实现镜头表现词典与 subject_id 绑定的交互字段。


## `/` 面板信息架构收口（2026-10-20）

用户确认的入口仅两层：顶层“基础面板 / Prompt 模板”；基础面板按面部、发型、肤色肤质、身高体态、服装、鞋履、首饰装饰、新旧等已有分类浏览。单项词汇作为分类内选项、配置下拉选项或 `/关键词` 结果，不再作为独立“词条”导航。

Prompt 模板按任务组织：角色设计、风格写真、换装写真、电商主图、UGC。题材（古装、现代、仙侠、国风）与画风（真人写实、动漫、插画）独立筛选；一个模板可属于多个适用任务。`/古装` 等题材搜索直接进入模板结果，`/服装` 等配置搜索进入基础面板。模板不足时显示空状态，不以普通词汇或服装片段冒充完整任务模板。

“全部 / 配置面板 / 词条 / 组合方案 / Prompt 案例 / Skill”不再作为独立内容类型导航；平台可用案例统一展示为 Prompt 模板。组合资源从此选择器排除，服务端资源与发布记录不删除。AI 完善角色设计保留为操作按钮，先说明再打开角色设计，不作为模板类别。

实施边界：本次调整角色台选择器，不创建换装/电商/UGC 的新完整模板，不实现参考图用途切换。现有模板的任务、题材、画风来自标题和搜索元数据的兼容分类，尚非持久化版本字段；后续目录升级应提供显式分类。保留预览确认、`[]` 槽位替换、键盘操作和 dictionary_configurations 结构快照。

验收：两个顶层入口、任务及交叉筛选、空分类返回、无组合资源、配置预览/插入、槽位填写、角色草稿保存与重载通过针对性测试；构建与部署另以本次发布记录为准。图像真实感和一致性不由导航测试证明。
