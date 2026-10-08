# 真人角色设计 Skill 调研与采用摘要 V1

状态：已核对候选；开始将方法适配为 iFrame 自有 Skill
日期：2026-10-08

## Observed

- GitHub 上已核对的候选主要分成三类：角色身份与多视角一致性、影视角色设定先确认后出图、题材或动漫造型路由。
- `eternityspring/shuohao-skills/character-refs`（Apache-2.0）有正面全身锚点、多视角派生、过期传播和换画风规则。
- 其工作台流程还要求一段描述先拆成 `stated / inferred / default`，用户确认后才建立角色；派生视图只引用正面全身锚点，不能互相形成身份根。
- `agentara/skills/video-character-design`（MIT）要求先写可确认的角色设计文档，再生成角色设定图。
- `Yunwuxin-666/Wuxin-Film-Skill` 覆盖影视、动画、武侠、仙侠和写实 CG，但 GitHub API 未识别许可证。
- `Litreily/codex-skill-eastern-beauty-director`（MIT）覆盖东方幻想古风和现代东方造型，偏女性审美。
- `eachlabs/skills/anime-avatar-generation` 的文档覆盖写实照片转动漫、Ghibli、Manga、Cyberpunk、Chibi、Shonen、Shojo、Seinen 和多视角角色表，但依赖其第三方 API，许可证未被 GitHub API 识别。
- `ChrisChen667788/wind-comic/costume` 的实际内容是古装题材的镜头语言和构图规则，不是角色身份设计 Skill。
- 性别和年龄不是独立 Skill 类型；它们应是角色档案中的事实或用户确认输入。古装、现代、修仙、动漫主要是造型、时代和画风路由。

## Direct implication

- 外部 Skill 只作为方法来源；不直接接管 iFrame 的资产 ID、素材 ID、存储地址、项目设计 revision、模型路由或生成 API。Avatar 保持独立入口。
- iFrame 采用两层结构：`character-identity-design` 负责可追溯的身份字段；`character-style-routes` 负责古装、现代、修仙、动漫及年龄阶段的造型约束。
- 男、女、少年、青年、成年人、老年等输入会改变需要确认的可观察字段，但不能由姓名、职业、性格或族裔自动推断具体五官、肤色、身材。
- 风格 Skill 只能产生带依据、可编辑的视觉设计草稿。用户确认前不得进入图片 Prompt；确认后才追加项目角色设计 revision。
- 多视角锚点和派生图的过期传播可以借鉴；当前只保存项目角色设计 revision 和图片变体，父锚点关系及过期传播尚未实现，不引入外部 `asset.json`。
- 工作台应优先显示“角色档案”和“视觉设计确认”两个连续阶段；“生成图片”是确认后的下一步，不应把上传或生成结果反向当成已确认身份。

## Adopted route coverage

| 路由 | 负责内容 | 不负责 |
|---|---|---|
| `realistic-modern` | 真人比例、现代服装、妆容、发型和材质 | 不决定职业或性格对应的脸型 |
| `historical-costume` | 古装时代、服装结构、材质、发饰和妆造 | 不把古装镜头语言当成角色身份 |
| `xianxia-fantasy` | 修仙/仙侠的身份可见锚点、法器、层叠材质和非现实视觉标记 | 不把特效、境界或法术状态永久写入身份 |
| `anime-stylized` | 动漫、国漫、漫画、Q 版等比例与线条路由 | 不绑定第三方出图服务 |
| `age-stage` | 儿童、少年、青年、成年人、老年各阶段的可观察年龄表现 | 不用刻板外貌替代剧本事实 |

## Not yet proven

- 外部 Skill 的出图质量、跨模型一致性和实际视频生成效果尚未在 iFrame 生产链路验证。
- “写实”“动漫”“古风”等文字约束对每个图片模型的实际遵循程度仍需运行时测试。
- 年龄阶段约束目前是文本设计规则，不等同于模型一定生成准确年龄。

## What would verify it

- 用同一角色档案分别选择四种路由，检查草稿字段是否只改变授权的造型维度。
- 用户确认后检查生成请求是否记录 Skill revision、identity/look revision 和最终 Prompt。
- 重生成或换风格后检查旧 variant 是否保留旧 revision 归属，未确认草稿不参与生成。
- 检查正面锚点、派生视图和单图重出之间的父子关系是否可追溯，且过期只改变状态不删除历史。
- 对男、女、老、少各至少一个角色进行人工视觉验收；人工验收结论不能反写成剧本事实。

## Sources

- https://github.com/eternityspring/shuohao-skills/blob/ef4ac0c313c7eeb1f918db5f0f0eb319745900bc/skills/character-refs/SKILL.md
- https://github.com/agentara/skills/blob/main/aigc/video-character-design/SKILL.md
- https://github.com/Yunwuxin-666/Wuxin-Film-Skill/blob/main/character-design/SKILL.md
- https://github.com/Litreily/codex-skill-eastern-beauty-director/blob/main/styles/东方幻想古风.md
- https://github.com/eachlabs/skills/blob/main/skills/anime-avatar-generation/SKILL.md
- https://github.com/ChrisChen667788/wind-comic/blob/main/skills/costume/SKILL.md
