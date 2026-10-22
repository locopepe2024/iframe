# 角色设计静态表情 Prompt v1

## 决策与范围

用户确认：面部细节是可组合基座；表情是可见的整体表现；情绪是心理意图；微表情严格涉及短暂变化，不能与局部面部细节混称。当前先实现角色设计表情 Prompt，时序、连续动作、呼吸和声音留待分镜设计时整理为 Skill。

本次不新增生成模型或修改分镜继承协议。表情是本次设计出图的表现，不写入稳定身份、肤质、服装字段，不自动成为后续镜头的一致性锁定条件。

## 已观察的代码与资料

- 代码事实：已有 60 项表情词条、静态文字和 motionText，以及表情选择面板；尚无按面部部位可调的表情 Prompt 模板。
- 代码事实：词典配置通过 dictionary_configurations 保存 preset_id、selections、resolved_fields、rendered_text；本次复用该契约。
- 本地资料：角色词典v1/AI人物表情.md 包含 53 项表演描述；AI人物微表情词典.docx 包含部位词汇与时序方法；AI人物情绪提示詞典.xlsx 包含 72 项中英对照及面部、动作、环境光影分栏。
- 资料中的精确毫米/秒数、AU 肌肉对应和模型效果主张未独立验证，不作为当前实现依据。表情模板出图质量仍需实际生成比较，单元测试不能证明生成效果。

## 信息结构

Prompt 模板 → 角色设计 → 模板类型：全部 / 完整设计 / 角色表情。

词典保留已有表情分类，将“基础微表情”改称“基础表情”；另提供面部表现细节分类。局部表现与静态身份特征分开：眉部表现不等于眉形，眼睑表现不等于眼型，嘴部表现不等于唇形。

表情模板由六个可选字段构成：眉部表现、眼睑表现、视线表现、嘴部表现、下颌状态、面部气色。气色仅表达泛红等临时状态，不替换基础肤色。模板先提供协调的预设，用户可以独立改选、不指定或留下 [] 槽位。没有选择的字段不输出。

静态表情不绑定题材或画风，在古装/现代、写实/动漫筛选下均可使用。

首批提供平静、含蓄微笑、露齿笑、大笑、温柔笑、得意坏笑、冷笑、疑惑、惊讶、含泪强忍、委屈、麻木、压抑怒火等静态模板。标题是检索和选择入口；底层按字段保存原始选择与可读描述，不从渲染后的句子反向解析。

## 应用边界

- 复用模板预览、使用此模板、词典槽位及保存设计路径，不增加局部 AI 优化入口。
- 表情配置保存在 dictionary_configurations；渲染文字进入角色设计编辑区，供现有 AI 优化和出图流程使用。它不是新增的后端 expression schema，也不保证模型服从。
- 不改写脸型、年龄、牙齿形态、肤质、发型、服装、摄影风格、背景、灯光或画幅。
- 不自动加全局 must_keep 或 negative_prompt；本次模板不附带负面列表。
- 动态原始资料仍保留在数据中作为后续整理来源，当前角色设计选择界面不显示动态参考。
- 本次不导入 Excel 拼接列，不把其中场景、滤镜或身体比例作为情绪的必选内容；暂不新增独立情绪 Prompt 模板。

## 成功标准及验证

1. 在既有角色设计模板任务内可筛选角色表情，完整设计与表情模板不混淆。
2. 应用前可调整局部表现；清空字段后预览和配置均不含该字段；[] 可继续使用词典填写。
3. 应用后记录结构化选择和静态文字，identity/look 不被写入表情细节。
4. 预览无时序、声音、固定毫米、AU 编码，无隐式皮肤美化或场景风格。
5. 前后端出图骨架的中性表情与正视要求仅在用户未指定时生效，不与选择的表情/视线形成无条件冲突。
6. 现有 60 项表情及其他模板仍可用；角色入口无动态参考。

受影响路径：frontend/src/lib/characterExpressionPrompts.ts、characterDictionaryPresets.ts、characterDictionaryCategories.ts、promptTemplateCategories.ts、components/modules/CharacterPromptDictionary.tsx 、前后端 characterPrompts/character_prompts 及相关测试。

验证命令（frontend）：

```sh
npm run test -- --run src/__tests__/characterDictionaryPresets.test.ts src/__tests__/promptTemplateCategories.test.ts src/__tests__/characterExpressionPrompts.test.ts src/__tests__/character-prompt-style.test.ts
npm run test:ui -- --run src/components/modules/CharacterPromptDictionary.test.tsx
npm run typecheck
npm run build
```

后端验证：`python3 -m pytest -q tests/test_character_prompt_language.py`。

## 后续分镜 Skill（未实施）

继承稳定身份和造型，独立指定当前镜头的情绪、面部表现、视线、动作；微表情 Skill 再组织触发、变化、维持、恢复。时序格式、镜头长度适配及继承约束在分镜阶段另行设计。

## 本次实施与验证结果

- 已接入 13 个角色表情 Prompt、32 个面部表现细节选项，以及角色模板类型筛选。现有 60 个整句表情继续保留。
- 已移除当前角色词典界面的动态参考展示，原始 motionText 数据仍保留。
- 已复现出图骨架无条件追加中性表情/正视与用户表情文字的冲突；前后端均改为仅在未指定时采用默认要求。
- 本地验证：前端逻辑测试 28 项、词典及角色工作台 UI 测试 94 项、后端提示词测试 15 项通过；类型检查、生产构建、git diff --check 通过。
- 未提交真实模型生成请求，未验证生成质量、AI 优化后保留率或线上效果；本次未部署。

## 2026-10-22 入口归并

角色表情的 13 个静态组合已并入既有“基础面板 → 表情”。整体表情选择保留 60 个整句词条；选择组合时展开六个可独立调整的局部字段。Prompt 模板发现列表只展示完整设计任务，不再重复列出表情组合。旧 `dictionary.template.expression.*` 配置仍由词典注册表识别，已保存快照可继续读取；新应用写入 `dictionary.panel.expression`。表情仍仅进入当前设计的表演文字，不写入身份或造型字段。分镜微表情的时序 Skill 仍属后续阶段。
