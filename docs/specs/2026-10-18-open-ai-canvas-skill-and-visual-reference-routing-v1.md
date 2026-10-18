# open-ai-canvas Skill 与视觉参考资源分流 V1

Date: 2026-10-18. Status: first routing slice implemented; media and workbench template import pending.

## Observed

- 当前平台目录的四个 `active` 条目均来自 open-ai-canvas 的 `backend/builtin/*/cards/*.md`；原始 frontmatter 的 `skill_type` 分别为 `template`、`technique`、`template`、`framework`。四条均无可用媒体变体和结构化视觉 `definition`。
- iFrame 的 `GET /platform-reference-library` 目前只按 `status=active` 过滤，故这四张方法卡被显示为“已发布的平台资源”。资产库页面没有把它们绑定到角色、场景或分镜的操作。
- 设置页已有 Skill 目录、安装/启用/卸载及版本快照；创作台 Agent 读取已启用 Skill。分镜润色支持显式 `optimization_skills`，但前端选择列表目前是固定的五项。设置页安装状态与分镜显式选择是两条不同路径。
- open-ai-canvas 除 Skill 卡外，还有 `backend/internal/workbench/seed/catalog.json` 的图片/视频工作台模板，以及 `web/public/short-drama-styles/` 的风格样图。模板中的示例媒体引用不等于已验证可再分发的图片版权或可用于模型输入的稳定媒体身份。

## 决策与作用域

1. `skill_type` 非空的 Markdown 方法卡进入 **设置 → Skill**，不作为平台视觉资产展示。Skill 可以指导一次规划或优化，但不能被当成参考图、人物、场景或道具 `@` 引用。
2. 可复用视觉资源进入 **资产库 → 平台参考库**，需有明确的结构化定义，或持久媒体身份和经逐条核对的许可。图片封面使用 WebP 预览；原图及许可证仍由媒体/来源记录管理。
3. 工作台模板是第三类：它有任务、输入槽位和示例，不等同于实际素材图。先作为可检索的模板候选，用户显式选择并预览输入/输出后才应用。
4. Skill 的“安装并启用”是用户级偏好；分镜某次润色的显式 Skill 选择是请求级输入。后端须记录实际选择的 Skill ID + revision。不能仅凭设置页启用就推断某个镜头用了该 Skill。
5. 六块组装卡适用图片提示词的草稿检查与多概念图一致性。它不改写 H3/Seedance 的视频输出契约，也不替代镜头结构、首尾帧约束或模型能力字段。缺少画面文字时，文字块记录“无画面文字”，不能编造标签；画幅由已选择模型能力和用户设置决定。
6. 所有 Skill 只在优化请求发出前参与上下文准备；优化结果仍由用户审核。不得在优化结果尾部暗中追加 Skill 文本或一致性约束。

## 首批迁移

- `shortfilm-5stage-structure`：短片整体规划 Skill；不默认套到单个 H3 镜头。
- `shortfilm-micro-drama`：竖屏短剧结构 Skill；适用于剧集/序列规划，单镜头只使用相关子规则。
- `freestyle-prompt-blocks`：图片提示词六块检查 Skill；用于图片草稿和多概念变体，不决定视频模型语法。
- `freestyle-template-match`：风格模板选择 Skill；用于检索和评估视觉方向，不是风格图片本身。

平台目录保留来源、许可、审核和 revision 记录，但 `skill_type` 卡从视觉资产读取面排除。迁移不改变现有四条审核记录，也不自动把 Skill 安装到任一用户账户。

首批代码在 `config/agent_skills` 放置四份经 iFrame 工位约束改写的指导，并在设置页既有 Skill 目录中提供安装。原平台目录中的四条审核记录留作来源审计；视觉资产 API 会过滤这些方法卡。当前分镜选择器仍只列已有的视频 Skill，图片六块卡不进入该列表。图片工作台的显式 Skill 选择、模板资源绑定、平台视觉图片导入属于后续独立批次。

## open-ai-canvas 后续候选清单

| 来源 | 已观察到的内容 | iFrame 目标 | 当前闸门 |
| --- | --- | --- | --- |
| `backend/internal/workbench/seed/catalog.json` | 图片、视频工作台任务模板，含名称、任务重点和输入槽位；例如场景母版、关键帧、首尾帧过渡、运镜测试 | 工作台模板目录，用户选择后投影到当前角色/场景/分镜 | 需确定输入槽位 schema、兼容模型、输出预览和模板 revision；它们不是成品图片 |
| `web/src/components/canvas/canvas-style-picker-modal.tsx` | 短剧风格名称、描述、提示词与示例封面 | 结构化风格预设候选 | 需拆分可复用参数与展示文案；每张封面逐一核对来源与使用权 |
| `web/public/short-drama-styles/*.jpg` | 18 张本地风格封面 | 平台视觉资产候选 | 仓库路径证明文件存在，不证明每张图片可向 iFrame 用户再分发或传给模型 |
| `scripts/workbench-catalog-seed.ts` | 工作台种子图片使用 Unsplash URL，另有内部 image ID | 仅作展示来源线索 | 需逐项确认摄影作者、许可、允许的访问用途和稳定媒体身份；不直接拷贝为共享资产 |

优先顺序：先导入无媒体的工作台模板定义并完成显式选择交互；再挑少量来源清楚的风格预设与封面做媒体试点。不得因为 open-ai-canvas 仓库整体为 MIT 就推断其引用的第三方照片、视频也为 MIT。

## 工作台模板第一批导入边界

假设：`catalog.json` 的文字任务定义由 open-ai-canvas 项目作者提供，仓库 MIT 许可覆盖这部分文字；此假设不延伸到任何第三方示例媒体。导入时固定上游 commit、源文件、单条内容 hash 和本地 revision。

第一批只纳入角色定妆/四视图、道具三视图、场景母版/多角度、镜头关键帧、首尾帧过渡和运镜测试八项。每项有 `kind`、适用工位、任务重点和明确的输入槽位；`media` 必须为空。目录只提供检索和预览，不参与 `@` 资产引用，不自动写入图片或视频提示词。用户要应用模板时，须先选择目标工位与输入，再预览由当前项目字段编译的完整草稿并手工确认；这一应用流程属于下一切片。

影响路径：`config/workbench_templates/catalog.json`、只读目录 API、前端模板检索入口和测试。验收：八项能按工位与类型检索；不存在图片 URL 或资产 ID；无匹配项为空列表；模板文字不会进入生成请求；既有平台视觉资产目录仍不包含模板。

## `@` 与“参考图”统一引用契约（实施前核对项）

- 两个入口应消费同一项目资产索引，并按工位约束作用域。共享库条目是否可用于项目图像输入，以服务端项目资产索引和提交校验为准；不能只根据 `source_scope=global` 判断允许或拒绝。搜索可展示来源、类型、变体职责；查询不能扩大可提交的作用域。
- 选择结果以 `{asset_type, asset_id, variant_id}` 为身份，预览 URL 只用于显示。相同名字的两个资产必须能区分；同一资产的多个变体必须逐一选择和删除。
- `@` 放入正文只表示显式文本绑定；“参考图”选择只表示候选或已选图像。提交预览需区分这两种意图，并展示最终实际提交的每张图、用途、身份和提示词。不能根据名字猜测补交图片。
- 图片或变体被删除、脱离项目或过期时，提交应明确失败或要求重新选择，不得偷偷换成同名资产或旧 URL。一次审核快照应记录源 revision 和选中的变体 ID；修改后重新审核。
- 角色工作台先接入统一搜索与选择契约，再做角色结构化参数。分镜和场景要逐入口核对列表、`@`、提交预览和后端校验，不以 UI 存在为有效提交证据。

### 第一轮代码核对与实施状态

**Observed（代码事实）**

- 角色/场景/道具工作台的 `@` 编辑器和参考图面板现在都从项目资产索引取得变体；`@` 候选可按名称、描述、来源和变体职责搜索。角色台从 `@` 选中此前未加入可用池的变体时，会加入可用池，再由原有提交校验核对稳定 ID。搜索不会根据同名文本自动绑定。
- 图片生成审核窗显示服务端投影的参考图 ID；当工位已加载索引时，也显示对应缩图、名称和来源作用域。索引缺失时仍保留原始 ID 供核对，不伪造预览。
- 分镜资产抽屉已经有结构化搜索，但首帧/尾帧分支曾错误遍历未过滤列表；现统一使用过滤结果。分镜帧候选仍只使用项目/系列成员索引。
- 分镜 `AssetChipBar` 和 `ShotCard.handleInsertAssetFromChip` 仍将资产名称编入 `[characterN:name]` 文本槽位。这是现有视频提示词语法；仅凭该文本不能证明同名资产在模型输入侧有确定的变体身份。

**Direct implication**：图片工作台的显式参考图已能在审核时对照稳定变体；分镜文本槽位需要单独设计稳定绑定与模型适配层，不能直接套用图片 `@` token 机制。

**Not yet proven**：当前 UI 搜索与预览测试不能证明供应商生成结果会遵守参考图，也不能证明分镜所有视频模型都按相同的 `characterN` 槽位解析。应以每种模式的实际提交包、适配器契约和生产回放验证。

**下一切片**：角色工作台的结构化角色定义与 revision；模板须先绑定输入槽位、显示完整应用草稿，再由用户确认。分镜名称槽位另做设计，不在本批暗改 provider 语法。

## 验收与验证

- 设置 → Skill 可检索这四个条目，显示来源、许可、版本和使用边界；安装后能在创作台 Agent 的相关任务中生效，未安装或禁用时不进入请求。
- 资产库平台视觉资源列表不再显示这四张方法卡；真实图片/视觉资源仍按独立审核和媒体预览流程显示。
- 分镜润色对显式选择的 Skill 做服务端 ID 与 revision 校验，并保持模型专用输出格式。图片六块 Skill 不被错误地塞入 H3 视频提示词。
- 图片模板、风格样图逐项核对作者、许可证、媒体来源、再分发/模型输入权利后才可导入资产库。未核对项保持候选，不借用仓库整体许可证推定。
- 测试命令：`pytest -q tests/test_agent_skills.py tests/test_platform_reference_catalog.py tests/test_storyboard_skill_contract.py`；`cd frontend && npm run typecheck`；相关 UI 用前端既有测试配置运行。

## 影响路径

`src/apps/platform_reference_catalog.py`、`src/apps/agent_skills.py`、`config/agent_skills/`、`frontend/src/components/settings/SkillsSettings.tsx`、`frontend/src/components/library/AssetLibraryPage.tsx`、分镜优化器选择与测试。平台媒体导入另开独立批次，不与 Skill 分流混合。
