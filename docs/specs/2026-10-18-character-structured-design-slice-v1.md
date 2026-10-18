# 角色工作台结构化设计切片 V1

Date: 2026-10-18. Status: implementation slice.

## Observed

- `CharacterWorkbench` 已保存 `character_design.design_draft`、确认 revision、identity/look 自由文本、参考图 ID 和用户核对项。`confirmedDesignDescription` 把两段文本和答案编入图片提示词。
- `/character-design/draft` 当前要求模型返回 `identity.visual_notes` 与 `look.visual_notes`，但未返回面部、身体、服装等可单独编辑的字段。
- `pipeline.update_asset_attributes` 对角色设计只检查确认时的 `identity.visual_notes` 非空；`character_design` 仍是可扩展字典。

## Decision

第一批结构化字段限定为可见外观，不包含剧情事实或镜头光线：

| section | fields |
| --- | --- |
| identity | `face`, `hair`, `skin`, `build`, `recognition_marks` |
| look | `clothing`, `palette`, `accessories`, `weapon` |

字段为有界文本，每项可留空。模型在草稿阶段按证据和用户要求提出值；无依据的细节标为现有 `creative_choice`，不得声称是剧本事实。用户可逐项修改。旧 `visual_notes` 保留以兼容历史草稿，但当该 section 存在非空结构化字段时，图片提示词以结构化字段编译，不再重复拼接同一 section 的 `visual_notes`。身份和造型两组分别遵守此优先级。

编辑任一字段后，原确认状态和已投影提示词标为待应用；用户点击“应用到图片提示词”才替换可见正文。生成仍须经过现有图片提交审核。保存草稿和确认设计分别写入 `character_design`；revision 包含结构化字段、参考资产和原有来源标记。确认要求结构化身份或旧身份视觉值至少一项非空。

## Boundaries

- 不从姓名、性格或职业推断肤色、年龄等身份事实。
- 不把场景光影、运镜、景别或剧情动作混入角色身份字段。
- 不自动把“设计参考图”转换成生成参考图；图片生成仍只使用用户在当前提示词/参考图面板显式选中的变体。
- 不自动重写已保存的历史提示词；旧 draft/revision 保持可读。
- 不引入新的模型调用；扩充现有一次草稿请求的结构化返回，兼容仅返回旧字段的模型。

## Success criteria

1. 模型返回字段有界、有效，错误类型被拒；旧模型只返回 `visual_notes` 时仍可编辑。
2. 用户修改某个结构化字段后，可见提示词在明确应用前不变；应用后只出现当前结构化值，不重复旧摘要。
3. 保存与确认 revision 保留结构化字段、来源和参考变体 ID；再次打开能恢复。
4. 提交前审核仍展示实际正文和参考图；未选中的设计参考图不进入生图请求。

## Affected paths and verification

`src/apps/agent_api.py`、`src/apps/comic_gen/pipeline.py`、`frontend/src/components/modules/CharacterWorkbench.tsx`、角色设计相关测试。运行后端角色设计/修订测试、角色工作台 UI 测试、前端类型检查与 PR CI。
