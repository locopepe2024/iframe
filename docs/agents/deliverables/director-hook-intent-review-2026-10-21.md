# 导演拍摄意图：钩子表达与下游传递复核

## 范围与假设

本次仅复核当前代码及仓库内已有GitHub调研记录，未重新拉取外部项目最新版本，未运行真实导演生成或观众留存实验。暂将用户“钩子”理解为叙事/视听吸引力，同时核查执行联动；若用户指扩展点接口，需要另行调整范围。

## Observed：代码事实

- `src/apps/comic_gen/presets/director-intent.md`要求视觉、表演、声音、节奏与连续性，但未定义钩子的设计单位。
- `DirectorProfile`保存emotional_arc/pacing/visual_language/performance_direction/dialogue_direction/sound_direction等总体文字；没有独立hook结构。
- 故事地图milestone支持setup/turn/reveal/payoff等事件功能，已有来源事件引用；这不等于观众信息披露或钩子方案。
- `DirectorPlanBeat`有dramatic_purpose/emotional_change/story_event_ids；`DirectorPlanShot`有visual_intent/director_effect及摄影、表演、声音字段，具备承接表现方案的基础，但没有hook引用、披露时机及兑现关系。
- llm.py明确director_effect用于希望观众感受或注意的效果，未要求说明何时建立疑问、何时保留或释放信息。
- `next_hook`接口是根据当前集结尾预测下一集开头的独立文本缓存，不能据此认定当前集导演意图已有钩子设计。
- 2026-10-01外部Film/Drama Skills复核记录了四个GitHub项目，已经建议剧情钩子/节拍/视觉提示卡；本次检查的上述主模型与编辑入口尚无对应的独立钩子表面。

## Direct implication

目前可以自由文字写钩子，但不能从专用结构直接检查“哪个事件提出哪个问题、哪个镜头执行、哪里兑现”。增加电影感或运镜词库不能单独补齐这个问题。故事事件的真实顺序与观众获知信息的顺序应分开。

## Not yet proven

不能由字段缺失断言现有输出没有好钩子，也不能断言结构化后能提高留存。尚未核对线上特定项目的导演意图及完整成片，亦未重审上述开源项目最新代码。

## 建议设计：先意图，再执行

导演意图中提供“观众关注与钩子”可编辑区，归当前集/当前场景的创作建议。钩子可为空，不规定每场反转、不固定3秒或10秒。

最小条目：

- id、作用范围、原文事件/来源引用；
- 钩子类型：疑问/信息差/目标阻力/情绪关系/视觉异常/声音预示/段尾悬念；
- audience_question：希望观众产生什么疑问或期待；
- known_information / withheld_information：此时观众知道与暂不展示的内容；未知剧情不能伪装为“保留的信息”；
- presentation：怎样通过画面、表演、声音及剪辑表达；
- payoff_event_refs：原文中可兑现的事件；没有兑现依据则标注未决或仅本段余韵；
- provenance与用户选择：原文依据/导演解释/可选新增，采用/修改/忽略。

拍摄计划beat引用hook_id，shot记录setup/hold/reveal/payoff执行角色以及可见/可闻线索。揭示时机用event/beat/shot引用，未确定镜头时不编造精确秒数。既有dramatic_purpose/director_effect仍负责节拍目的和镜头效果，不复制成第二套权威文本。

示例（假设而非现有剧本事实）：原文已写“主角发现旧伤”并在稍后揭示识别关系，可建议先用手部反应与视线建立“他认出了什么”的疑问，再在原文揭示事件处兑现。不能为制造钩子新增凶手身份、神秘信物或不在原文中的对白。

下游分工：角色/场景/道具资产只承接已有资产的造型和状态要求，不承接信息披露节奏；分镜承接镜头展示/隐藏、反应及声音；跨批生成携带未兑现条目，兑现后记录状态，避免无故丢失或提前揭示。

## 薄切实施与验收建议

1. 先选一集现有剧本离线生成可审阅的钩子建议，不改变已确认内容、不调用收费出图。
2. 在用户接受设计后实现有界结构、兼容旧数据的编辑与保存；新增内容作为导演补充，不反写原文。
3. 再贯通到beat/shot及跨批handoff；检查引用有效性、未采用内容不泄漏、保存重载及冻结快照。
4. 比较同一剧本优化前后的计划，人工核对问题是否明确、线索可拍、兑现有依据、无新增剧情和提前揭示。受众吸引力需另做观看实验，不能靠schema测试证明。

相关路径：models.py、llm.py、presets/director-intent.md、导演profile持久化/摘要与拍摄计划handoff、DirectorInterpretationVisualEditor及拍摄计划编辑器。验证命令须在确定实施切片后根据受影响测试选择；本次为审计文档，无运行时变更。

## 已有外部调研来源

- docs/specs/2026-10-01-external-film-skills-review-v1.md
- docs/specs/2026-10-01-long-script-storyboard-context-copy-v1.md
- https://github.com/zenstory-ai/drama-skills
- https://github.com/kangarooking/director-skills
- https://github.com/62656456/ai-film-skills
- https://github.com/Coconah/AI-Short-Drama-Agent-Skill

这些来源支持设计借鉴，不构成运行质量或留存提升证据。
