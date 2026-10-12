# 角色设计 Skill 提案与图片提示词同步 V1

状态：实现切片
日期：2026-10-12

## Observed

- 角色设计 Skill 将无来源的外貌或造型细节列为 `unresolved`。
- 角色工作台把 `unresolved` 展开成一组要求用户逐项填写的输入框。
- 用户生成草稿后，修改身份视觉、造型视觉或待核对答案不会更新图片 Prompt；目前通常要等到确认设计，或手工复制文本。

## Decision

1. “资料里没写”不等于“必须让用户回答”。用户主动运行角色设计 Skill 后，Agent 要结合剧本事实、选定题材 / 画风、年龄阶段、已确认设计和参考图，完成一份连贯、可用于出图的身份与造型方案。
2. 对具体领型、袖型、腰线、面料、鞋履、发式、配饰等可设计细节，Agent 应给出一套明确、可编辑的创意方案，并标为创意选择。不能只返回缺项清单，也不能把创意选择伪装成剧本事实。
3. 只有明确事实互相冲突、需要用户决定的角色身份 / 年龄 / 项目画风，或创意提案会改变人物设定的重要分歧，才保留为待核对项。每条待核对项应带一条基于上下文的建议；用户可采纳或自行改写，不要求从空白开始设计。
4. 用户生成的草稿仍是草稿，不保存资产、不创建 revision、不触发图片任务。
5. 工作台提供显式的“应用到图片提示词”动作，把当前身份视觉、造型视觉和已采纳的建议编译到全身、三视图、肖像三个 Prompt。此操作只更新本地 Prompt，不保存角色设计、不创建 revision。用户可以随后编辑 Prompt。
6. 生成草稿后自动把候选带入当前图片 Prompt；之后身份 / 造型 / 建议编辑会在主图片工作区显示待应用状态和按钮，避免操作只藏在移动端折叠的侧栏里。
7. “确认设计”继续负责保存角色设计 revision；生成提示词与确认设计仍是两个不同动作。
8. 年龄或画风待核对建议可以附带对应选项值。采用建议时，工作台同步年龄阶段或题材画风选择器；重新应用 Prompt 后应只保留新的选项描述。

## Boundaries

- 不将 Agent 的创意选择写回剧本、导演解读或拍摄计划。
- 不推断族裔、国籍、肤色、阶层等非必要身份事实；创意造型必须与已知时代和题材相容，无法确认史实依据时明确写成架空设计方案。
- 不自动生成图片或视频，不创建或覆盖图片变体。
- 采纳待核对建议仅把建议写入当前设计草稿的字段答案；角色设计 revision 仍需用户明确确认。

## Affected paths

- `config/agent_skills/character-identity-design.md`
- `config/agent_skills/character-style-routes.md`
- `config/agent_skills/catalog.json`
- `src/apps/agent_api.py`
- `frontend/src/components/modules/CharacterWorkbench.tsx`
- `frontend/src/components/modules/CharacterWorkbench.test.tsx`
- `tests/test_agent_skills.py`

## Success criteria

1. 输入“少年剑客，素黑劲装”生成设计草稿时，模型须提出可见的身份和服饰细节；不能仅把每个未提及的服装字段列为待核对。
2. 对确有冲突的待核对项，API 返回问题和建议；UI 支持采纳建议或编辑建议。
   涉及年龄或画风的采纳还同步选择器，避免建议视觉值与 Prompt 末尾的阶段 / 路由标签矛盾。
3. 生成草稿后，三个角色图片 Prompt 自动包含当前身份视觉和造型视觉；编辑后点击“应用到图片提示词”会再包含当前已采纳建议；不调用保存 API、不创建 revision。
4. 草稿编辑后，主图片工作区明确提示需要应用；移动端无需打开角色档案侧栏也能操作。
5. 确认设计仍按现有契约保存 revision。

## Verification

- `pytest -q tests/test_agent_skills.py tests/test_character_design_revision.py`
- `cd frontend && npx vitest run --config vitest.ui.config.mts src/components/modules/CharacterWorkbench.test.tsx`
- `cd frontend && npm run typecheck`

## 2026-10-12 runtime correction

Runtime observation: a draft for “少年剑客，素黑劲装” still showed five unanswered items for age appearance, image style, facial details, body proportions and costume. The model returned the old `unresolved` checklist, and the API accepted those strings without suggestions; the workbench rendered each as an empty answer box. This does not prove which model instruction caused the output.

The API now asks the model to revise a checklist or a review item without a concrete suggestion. If the second response still returns a checklist, draft generation fails instead of creating empty review fields. `review_items` is reserved for an explicit conflict between supplied facts or confirmed settings; unspecified visual details belong in the creative proposal. The workbench suppresses unanswered, unsuggested legacy checklist items while preserving answered items and explicit conflicts. A user can regenerate the design to obtain the revised proposal; no existing confirmed design is rewritten.
