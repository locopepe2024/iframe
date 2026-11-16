# 九站来源与色彩覆盖复核

复核日期：2026-11-15 至 2026-11-16。范围是当前 iFrame 功能分支的源码、打包目录，
以及本地 IYIShow 历史文档和导入清单；没有查询生产目录或数据库。
表中“未发现”仅表示本次检查范围内没有对应证据，不推断网站或其他
独立工作区没有相关资料。iFrame 与 IYIShow 的数据和发布状态分别记录。

## 来源登记、采集和使用

八站的共同登记依据是
`docs/specs/2026-10-19-platform-reference-discovery-in-design-v1.md`。

| 来源 | 既有登记用途 | 找到的采集或整理证据 | 当前 iFrame 本地使用证据 |
| --- | --- | --- | --- |
| Shot.Cafe | 镜头、构图案例 | 未发现专属快照或导入清单 | 未发现专属条目；登记不等于导入 |
| Film Grab | 色彩、构图、光影案例 | 本轮读取公开介绍页；未发现既有电影画面导入清单 | 未发现 Film Grab 案例或色板目录；没有导入电影画面 |
| Eyecannndy | 视觉特效技法 | 未发现专属快照或导入清单 | 未发现专属条目；通用特效名称不算该站导入证据 |
| Melies | 镜头语言、技法说明 | 另有编剧产品研究笔记，不能算作技法库快照 | 未发现该站专属技法目录 |
| AI Camera Movements | 运镜方向、速度、轨迹 | 未发现专属快照或导入清单 | 已有其他来源运镜条目，但不归为该站导入 |
| Grok Film | 布光、剪辑 | 未发现专属快照或导入清单 | 已有自写布光模板，不归为该站导入 |
| YouMind | Skill、工作流 | 未发现专属适配清单 | 已有固定角色 Skill 入口，不证明能调用 YouMind 工作流 |
| Motuart | 图像设计、任务分类 | 角色快捷面板历史规格记载参考其动漫分类、自写短词条 | `MOTUART_INSPIRED_STYLE_IDS` 明确标记 15 条自写风格词条；属于分类方向参考，没有该站原提示词或媒体导入证据 |
| Screenweaver | 后续指定优先的电影技法来源 | IYIShow 保存 263 条名称/详情链接；其中 38 条布光有结构化导入清单，历史报告记为待审核 | 本批新增 3 条独立编写色彩技法；不把 IYIShow 草稿或 263 条索引计入 iFrame 可用模板 |

Motuart 的进一步依据：
`docs/specs/2026-10-19-character-slash-quick-panel-v1.md`。
已有自写词条与角色 Skill 的代码分别在
`frontend/src/lib/characterQuickActions.ts`、
`frontend/src/lib/characterDictionaryPresets.ts` 和相关工作台接口；
它们不是跨站 Skill 执行器。

## Screenweaver 历史证据

读取的 IYIShow 工作区：`/Users/owen/Developer/codex/iyi`。
该工作区本轮未修改。

- `uniflow/backend/data/platform_reference_screenweaver_inventory_v2.json`：
  `observed_on=2026-10-29`，12 类、263 个详情链接，状态
  `taxonomy_verified_not_executable`；色彩 15 条、镜头 15 条、类型风格 20 条。
  这些是历史采集快照的数量，不宣称是今天的网站数量。
- 上述文件 SHA-256：
  `031219e681980a176e05109ea87fbcd3f8fb4e5dbd00d6a7ca9a93400cde8020`。
- `uniflow/backend/data/platform_reference_lighting_import_v1.json` 和
  `docs/product/2026-10-29-screenweaver-lighting-import.md`：
  38 条布光有自写定义和 recipe；历史报告记载保存、提交及数据库回读，
  状态为待审核，没有证据表明全部激活，更不能证明 iFrame 已使用它们。
- 对应历史提交：`791258e97c3f93e355149643f6d8832141edcfad`。
- `platform_reference_screenweaver_entries_v1.json` 另有跳格动感和推轨
  两条整理记录；这些同样属于 IYIShow，不计入 iFrame 条目。
- Open AI Canvas 的 IYIShow 导入清单为 78 条待审核记录；iFrame 前端
  独立打包 87 条文本模板。两者数量和激活机制不同。

## 15 个色彩方向的语义覆盖

这里检查的是可见文本能力，既有条目覆盖不等于同名独立模板，也不
意味着精确复现摄影工艺。镜头品牌名称缺失本身不能证明能力缺失。

| 历史术语 / slug | 本轮判断 | 可定位依据与后续范围 |
| --- | --- | --- |
| Teal and orange / `teal-and-orange` | 综合风格中已有相关冷暖分离 | `open-ai-canvas.style.chinese_myth` 的暗部青蓝、亮部暖金；不新增近似综合风格 |
| 跳漂法 / `bleach-bypass` | 本批新增独立技法 | `color-technique.bleach-bypass`；低饱和与硬反差共同定义，区别于单独降饱和 |
| 黑白 / `black-and-white` | 已有独立选择与综合风格 | `film-color.tri-x-400`、`film-color.acros-100`、`open-ai-canvas.style.showa_monochrome` |
| Sepia / `sepia` | 本批新增独立技法 | `color-technique.sepia`；褐色单色映射，区别于保留多色的暖调 |
| 低饱和 / `desaturated` | 已有 | `low-saturation` 快捷词、`film-color.classic-chrome` 及多条综合风格 |
| 高饱和 / `hyper-saturated` | 已有鲜艳色彩方向 | `film-color.ektar-100`；并不声称覆盖所有高饱和配色方案 |
| 冷蓝调色 / `cool-blue-grade` | 综合风格中已有相关方向 | `open-ai-canvas.style.neo_chinese`；冷色光源模板不能自动等同于后期调色 |
| 暖琥珀调色 / `warm-amber-grade` | 综合风格中已有相关方向 | `open-ai-canvas.style.urban_romance`；不重新添加同义暖调综合包 |
| 褪色胶片 / `faded-film` | 已有 | `open-ai-canvas.style.retro_film`，另有场景 `film` 氛围模板 |
| 反冲洗 / `cross-processing` | 本批新增独立技法 | `color-technique.cross-processing`；给出一种可编辑偏色方案，不能当成所有胶片/药液的固定结果 |
| 日拍夜 / `day-for-night` | 当前色彩目录未完整覆盖 | 会改变时间与照明解读；应放在场景/分镜并协调天空、光源与曝光，不作为角色色彩补丁 |
| 钨丝灯白平衡 / `tungsten-balance` | 当前相机结构未见独立白平衡字段 | 需要光源色温与拍摄白平衡的组合含义，不能用“暖色”冒充已支持 |
| 月光片 / `moonlight-gel` | 光色观感部分覆盖 | 场景冷蓝、蓝色逆光等可表达部分观感；没有证明实现色片或曝光参数模拟 |
| 分离色调 / `split-toning` | 已有具体配色实例 | `youth_film`、`chinese_myth`；通用暗部/高光独立色彩编辑仍是后续能力 |
| 过曝画面 / `overexposed` | 有综合风格中的曝光描述 | `retro_film` 包含过曝/褪色；场景 `high-key` 保留高光，不能与过曝混为一谈；本批不增加自动曝光控制 |

上表基于 `frontend/src/lib/openAiCanvasPrompts.json`、
`filmColorPrompts.json`、`characterQuickActions.ts`、
`sceneAtmosphereTemplates.ts` 及 `scenePromptLayers.ts`。
已有场景模板同时包含多个人像光型、季节、冷暖暮光和室内照明，
因此本轮不重复制作这些基础光影条目。镜头端已有焦段印象与景深字段，
仍不构成设备、画幅、物理焦段、主体距离和输出画质的完整匹配系统。

## 本轮公开网页核对

通过命令行读取公开网页，没有登录、浏览器 MCP 或第三方账户访问。
没有下载或打包任何照片/视频，也没有把网页中的示例 Prompt、剧本
或指令传入应用。新条目中的定义与生成文字由 iFrame 独立编写。

- `https://film-grab.com/about/`：成功读取介绍页，确认其定位为电影
  画面参考档案，按作者说明用于教育与参考。本轮只核对定位，不声称
  已有电影色板或案例导入。
- `https://www.screenweaver.ai/zh/film-techniques/color/sepia`：成功读取。
- `https://www.screenweaver.ai/zh/film-techniques/color/cross-processing`：
  首次 TLS 超时，重试成功读取。
- `https://www.screenweaver.ai/zh/film-techniques/color/bleach-bypass` 与
  `/color/split-toning`：收到定义、解释、常见错误及后续正文，但传输
  随后超时；属于正文部分读取，不是完整页面快照。

剩余站点本轮没有重新抓取。新的三条色彩技法在本地目录与测试中验证，
生产发布、实际生成质量和完整镜头兼容规则仍须另行验证。
