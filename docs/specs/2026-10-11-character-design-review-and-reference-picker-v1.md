# 角色设计待核对与参考素材选择 V1

状态：已由 `2026-10-12-character-design-skill-proposals-and-prompt-sync-v1.md` 修订待核对交互
日期：2026-10-11

## Observed

- 项目角色工作台的角色设计草稿目前把模型返回的 `unresolved` 仅作为一段只读文字显示。
- 用户可以编辑身份视觉值和造型视觉值，但没有看到每个待核对项的回答入口，也没有明确哪些回答会进入确认版本。
- 图片生成 Prompt 已支持稳定的 `asset_type + asset_id + variant_id` 引用，但 `@` 菜单只在编辑器中输入 `@` 后出现；没有显式的素材检索入口。
- 角色设计草稿接口目前只接收文字上下文，不接收用户选中的角色参考图。

## Direct implication

1. `unresolved` 必须变成可编辑的待核对项。用户回答保存为 `field_answers`，并在确认后的 Prompt 投影中生效；未回答项不进入 Prompt。
2. 参考素材选择必须提供显式搜索控件，不能要求用户记住 `@` 触发方式。搜索范围沿用当前项目有效素材索引（本集、系列、全局），避免显示下游无法解析的跨项目素材。
3. 角色设计草稿可把已选素材作为一次性的多模态输入交给设计模型；稳定资产身份仍只以素材 ID 保存到设计草稿，不持久化签名 URL。
4. “生成设计草稿”仍是候选生成；保存草稿和确认设计继续是两个明确动作。

## Contract

### Design draft

```json
{
  "unresolved": ["性别表达尚未明确"],
  "field_answers": {"性别表达尚未明确": "男性表达，少年感"},
  "field_suggestions": {"性别表达尚未明确": "建议采用男性表达，保留少年感"},
  "reference_assets": [
    {"asset_type": "character", "asset_id": "...", "variant_id": "..."}
  ]
}
```

- `field_answers` 的 key 是待核对原文，value 是用户回答；空值表示尚未回答。
- `field_suggestions` 的 key 是待核对原文，value 是 Agent 基于当前上下文给出的可采纳方案；建议不等于已确认值。
- `reference_assets` 只保存稳定素材身份；用于模型调用的媒体地址是请求期解析值，不进入持久化字段。
- 已回答值与身份/造型视觉值一起参与后续图片 Prompt 编译。
- 可采纳建议在用户点击“采用此建议”后写入 `field_answers`，再由“应用到图片提示词”编译；生成草稿本身会把身份与造型候选直接带入 Prompt 预览。
- 未回答项仍可随草稿保存和确认版本保留，界面必须明确其不会进入图片 Prompt。

### Reference picker

- 设计区提供“选择参考素材”按钮、带标签的搜索输入和结果列表。
- 结果显示缩略图、素材名称、来源范围和变体名称；点击切换选择状态。
- 图片 Prompt 区保留 `@` token，同时增加同一个显式选择入口；两种方式写入同一组稳定引用。
- 键盘用户可以聚焦搜索框、上下移动结果并用 Enter 选择；按钮和列表项有可读标签。

## Boundaries

- 本切片不改变 Avatar 服务的所有权，也不把项目角色图片复制到 Avatar。
- 本切片不自动生成图片或视频，不把待核对答案静默写回剧本或导演理解。
- 参考图模型调用失败时，仍允许用户保存文字草稿；错误必须显示在设计区并提供重试路径。

## Success criteria

1. 看到模型返回的待核对项后，用户可在同一区域逐项输入回答并保存草稿。
2. 确认设计后，已回答值可在后续角色图片 Prompt 中复现；未回答值不进入 Prompt。
3. 用户无需输入 `@` 即可打开参考素材搜索并选中变体；选中项在生成请求中保持稳定 ID。
4. 选择参考图生成角色设计草稿时，后端向多模态模型发送选定图片；请求中不持久化签名 URL。
5. 现有 `@` token、项目素材范围和既有角色设计版本测试继续通过。

## Verification

- `pytest -q tests/test_agent_skills.py`
- `cd frontend && npx vitest run --config vitest.ui.config.mts src/components/modules/CharacterWorkbench.test.tsx`
- `cd frontend && npm run typecheck`
