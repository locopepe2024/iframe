# 词典结构与检索扩展规划 v1

状态：代码审查与本地 CPU 规模实验完成；本文为后续实施设计，未迁移线上数据，未修改检索行为。当前版本不处理参考图。

## 目标

角色词典后续支持人类不同年龄阶段、动物以及其他主体，不通过不断增加互斥的大分类解决所有问题。保留“基础面板 / 词典 / Prompt 模板”用户入口，底层统一条目和检索契约。避免在人类成人模板上直接套用动物或婴儿描述。

## Observed：代码事实

基于本地提交 3d77e3ea：

- 内置检索候选 552 项：431 个词典预设，加 121 个非路由快捷选项。快捷选项总数 125，其中 4 个为路由。16 个分类组、89 个子分类。
- `CharacterDictionaryPreset` 已有 id/type/categories/source、文本、字段、默认值、约束；但没有独立的主体类型、物种、年龄阶段、适用条件、稳定字段目录或逐项修订号。
- `dictionaryConfiguration` 保存 preset_id、schema_version、selections、resolved_fields、rendered_text；中文标签和选项显示文字同时承担存储键/值。标题或标签变更可能影响旧值恢复，不代表当前已发生数据丢失。
- 身份和造型顶层字段已有稳定英文键；词典槽位则主要按中文标签正则推断分类。两套结构尚未统一。
- 新表情模板的配置按部位保存，但平台 `payload.structured_prompt` 前端契约主要仍是 `{content: string}`，不能据名称认定平台条目已经具有同样的部位结构。
- `CharacterPromptDictionary.tsx` 每次渲染都重新构造内置/平台 entries，反复 `filter` 统计分类、为匹配拼接/转小写全文；平台 terms 用数组 includes 判定归属，平台资源增长时该段最坏可接近平方级比较。
- 结果和 select 选项都完整渲染，没有分页、窗口化或结果上限；按键与输入都可触发重渲染。
- `dictionaryPresetFields` 对每个槽位扫描内置词条及快捷选项；目前不会把平台词条合入该字段选项源。不能只扩大平台目录就认为所有配置面板能复用新增内容。
- 面板挂载会调用无参数 getPlatformReferenceLibrary，全量获取当前 active 非 Skill 资源；切换刷新会重新获取。
- 后端 `src/apps/platform_reference_catalog.py` 每次 list_resources 读取并解析整个 JSON manifest、校验所有资源、线性过滤，返回完整匹配资源。已有 query/category/tag/domain/type，但没有 limit/cursor、主体/年龄维度或列表/详情分离。
- 前端搜索含内容文本；后端 query 搜 title/summary/tags/kind/category，不搜内容文本。直接换成远端搜索会改变召回结果。
- 当前保存路径只对 dictionary_configurations 做集合/总量约束（最多 50 项、序列化最多 60000 字符），未逐项执行新的结构化 schema 验证。

## Direct implication：直接推论

1. 婴儿和老人应是人类的年龄维度；动物属于主体类型，猫/犬/马属于物种维度。它们不能全部挂成与“服装、表情、材质”同级且互斥的内容分类。
2. 现有 552 项不能证明未来几万项仍流畅；重复构造、重复计数和全量 DOM 的工作量会随内容增长。
3. 新增几组数据并不能解决检索性能，也不能自动解决适用性、字段回填和版本兼容。

## 本地规模测量：runtime observation

可复现脚本：`frontend/scripts/benchmark-character-dictionary.mts`。

```sh
cd frontend
./node_modules/.bin/vite-node --config vitest.config.mts scripts/benchmark-character-dictionary.mts
```

本机 Node/Vite 环境，内置数据复制到目标数量，每种操作预热一次并运行 15 次；以下记录中位数。分类实验逐个遍历全部组/子分类，模拟重复计数的规模开销，并非一次真实 React 渲染的精确复刻。预计算搜索实验只测查询，构建索引成本不在该列。

| 候选条数 | 分类遍历统计 | 每次重建搜索文本并匹配 | 已预计算文本匹配 |
|---:|---:|---:|---:|
| 552 | 1.20 ms | 0.29 ms | 0.02 ms |
| 10,000 | 21.80 ms | 3.69 ms | 0.18 ms |
| 50,000 | 105.43 ms | 18.20 ms | 0.86 ms |

这些测量不含网络、JSON 解析、React、布局绘制、低端移动设备或内存成本；不是容量承诺，也不能证明线上卡顿原因。

## Not yet proven / Hypotheses

- 尚未证明当前线上存在词典性能问题；本次未访问生产环境。
- 假设目录扩到万级后，重复统计、全量载入和 DOM 会成为主要风险；仍需完整目录与移动设备测试确认贡献比例。
- 尚无证据需要向量数据库、专用搜索集群或预先引入 Web Worker。先完成确定性字段/别名检索、索引和有界返回，再按测量升级。

## 目标数据模型（提案，尚未实施）

每个条目具有稳定 `entry_id + revision`，显示文案可以修改；分类、字段、选项均使用稳定 ID。旧 ID 原样保留，不因中文标题变化生成新身份。

独立维度：

| 维度 | 用途 | 示例 |
|---|---|---|
| entry_kind | 使用方式 | term / panel / prompt_template |
| semantic_domain | 应用位置 | identity / look / expression / style |
| subject_kind | 主体类型 | human / animal；以后按需求扩展 |
| species_id | 物种 | cat / dog / horse |
| life_stage | 年龄阶段 | 人类 infant / child / adolescent / adult / elder；动物按物种定义 |
| field_ids | 字段目的地 | human.face.shape / expression.mouth.state / animal.coat.pattern |
| task/topic/style | 模板发现维度 | character / 古装 / 写实 |
| applicability | 显式适用范围 | human + elder；animal + cat |
| aliases | 同义词及语言 | 老人 / 老年人 / elder |

`subject_kind` 和 `life_stage` 为不同维度；不将“幼猫”和“婴儿”共用一套人类字段。不把“老人”自动等同弯腰、皱纹或疾病，也不强制婴儿模板服装、场景和风格。

条目例子：

```json
{
  "schema_version": "iframe.dictionary-entry.v2",
  "entry_id": "human.expression.closed_lip_smile",
  "revision": 1,
  "entry_kind": "term",
  "title": "闭唇浅笑",
  "aliases": ["浅笑"],
  "category_ids": ["expression-mouth-state"],
  "applicability": {"subject_kinds": ["human"]},
  "values": {"expression.mouth.state": "双侧嘴角轻轻上扬，嘴唇闭合"}
}
```

上例未声明 life_stage：仅在已明确 human 的前提下表示不限年龄；缺少整个 applicability 则是 unknown，不能认定适用于所有主体。通用材质/颜色等也要显式声明适用范围。UI 可展示“未分类”，不能通过猜测把旧成人词条开放给动物/婴儿。

年龄字段不是必填。用户未选年龄时不限制已知适用人类的选项；一旦显式选择婴儿/老人，再按明确适用性过滤。直接编辑 Prompt 始终保留，不通过检索筛选擅自重写用户输入。

字段注册表负责 id、中文显示名、别名、适用主体、值类型、编辑控件、合并方式。新字段依据注册表扩展；不继续给 dictionarySlotCategory 堆正则。面板、[] 槽位、词典使用同一个选项服务。

保存配置 v2 需包含 preset_id/revision、field_id、option_id/revision、解析值快照；[] 槽位另存 slot/unset/selected 状态，避免把显示文案“不指定”当成真实值。快照用于恢复历史设计，不能随新目录静默重渲染。后端逐项验证并拒绝超限或未知 schema。

## 检索架构（提案）

### 本地索引与渲染

- 归一化内置/平台条目一次，按目录版本构建 byId、byKind、byCategory、byField、bySubject、byLifeStage 和 aliases 索引；分类计数预计算。
- 模板任务/题材/画风改为显式元数据，旧条目用一次性兼容适配；不在每次按键时根据标题重新猜测。
- 文本做一次 Unicode NFKC/大小写/空白归一化，保留来源原文不变。繁简、拼音、跨语言同义词只用显式别名，不能假定自动识别。
- 候选先按主体、年龄、入口、字段/分类缩小，再做关键词查询。排序：标题/别名精确匹配、前缀匹配、标题包含、摘要/正文包含；以稳定 ID 作最终同分排序。
- 本地查询先测量再决定节流；远端查询建议约 150 ms debounce，加请求取消/序号校验以拒绝旧响应。
- 首批结果建议 40 项，以显式“更多”或分页继续获取；分类统计返回总体 counts，不能从当前页推断目录总量。
- 大字段选项改成可检索的有界列表，不能仅给结果卡片分页而保留数千个 select option。
- useMemo 缓存条目与索引，但它不替代稳定索引设计；按方向键不重建索引。

### 平台查询与版本

- 增加版本化检索端点，参数含 query/kind/category/field/subject/life_stage/task/topic/style/limit/cursor。
- 返回轻量摘要：id/revision/title/snippet/分类/适用范围、total/facets、catalog_revision、next_cursor。选中后按 id/revision 取可应用详情。
- cursor 绑定目录版本、查询与排序；目录变更时显式重启查询，不拼接不同版本页。
- 本地包与平台资源按命名空间 ID 合并，不按显示标题去重；同名但不同语义/年龄/物种选项允许共存。
- 目录 owner 继续负责审核、撤回和发布。内存索引可按文件签名/目录版本重建，校验失败不能静默沿用旧版本。写入/失效需覆盖同进程和多 worker。
- 列表缓存和详情缓存按目录修订及当前账号/部署边界隔离，退出登录时清理；不因性能优化取消现有认证/no-store 约束。
- 撤回的条目不得作为新选择应用；保存的历史快照可供查看，明确其来源状态。
- 先在现有 owner 上做分页及索引；是否切换 SQLite FTS 等存储取决于目录体量与延迟测量。中文检索分词/子串语义必须单独验证，不能假定 FTS 默认支持。

## 分阶段实施与边界

1. **兼容数据层**：字段和分类注册表；主体/年龄适用性；版本化条目及旧数据适配。先给现有条目做可审核标注，不自动猜测全部适用性。不新增动物/婴儿素材。
2. **本地检索层**：抽出独立纯函数索引及查询，预计算分类计数/搜索文本；给结果和字段选项加有界加载。保留现有目录和 Prompt 插入行为。
3. **平台检索层**：版本化分页/详情/筛选；统一内置和平台选项服务、搜索语义、失效与请求竞态处理。
4. **内容扩展**：先用老人、婴儿、猫三组小样验证字段与筛选，再批量增加种类。不把新数据量先堆到当前全量数组里。

每步独立验证、可回滚。旧保存设计保留快照；v1 读取适配不应改写历史。未知版本/适用性显式标记，不能用兜底成人模板掩盖问题。

## What would verify it：验收计划

功能验证：人类与动物过滤、婴儿与成人字段隔离、年龄未选的行为、通用/未知适用性、同名不同条目、别名检索、字段清空/[]、旧版恢复、新修订/撤回、平台与内置一致来源、分页重复/遗漏、旧响应覆盖、账号退出失效。

性能目标（待验证，不是已达成）：

- 1k/10k/50k 真实长度条目分别测冷启动、索引构建、查询 p50/p95、内存、下载字节和 DOM 数量。
- 目标设备包含中低端移动浏览器；索引就绪后本地查询 p95 < 30 ms，输入到列表更新 p95 < 100 ms；具体目标以设备实测校准。
- 建议首批 DOM 结果不超过 40；目录导航和选择预览不随全量规模线性增加 DOM。
- 服务端单独记录 manifest/索引加载、匹配、序列化时间，不能把网络延迟全归因于检索算法。

本次只提供审查、测量与规划；未实现 v2、分页或数据库迁移，未部署。
