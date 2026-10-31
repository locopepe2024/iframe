# OpenFilm 与 iframe skill 剪辑接入总结

日期：2026-10-31。iframe 核查基线：GreenA 发布提交 `301dd1d0`。本次只研究、记录；用户决定先继续优化剪辑交互，skill 执行链后续开发。

## 已核实的外部设计

公开资料（读取时 main 内容，未固定上游提交，不代表本机已安装或运行）：

- https://github.com/openfilm/openfilm
- https://github.com/openfilm/openfilm/blob/main/packages/openfilm/MANUAL.md
- https://github.com/openfilm/openfilm/blob/main/packages/openfilm/skills/long-to-short/SKILL.md

OpenFilm 用 `film.html` 描述轨道、素材、时间区间和样式，页面通过 `window.film.frame(t)` 按时间确定性绘制。Studio 和 Agent 读写相同项目文件。手册要求 Agent 修改前重读项目，保留用户 overrides 和锁定轨道。

CLI 将执行能力提供给 Agent：`open` 打开项目，`look` 生成检查用画面并检查重复渲染一致性，`render` 输出成片，`get` 对接素材生成及转录。skill 规定制作方法，并不单独提供渲染能力。

长视频切片 skill 利用带词级时间的转录定位片段，强调语义完整、独立可理解、切口避开单词、移动端构图。对同一源文件使用多个时间区间引用，不预先反复重编码。

未执行 OpenFilm 安装、导出、性能或兼容性测试；以上为文档事实，不能当作运行验收结果。

## iframe 已有基础（代码事实）

- `src/apps/editing/api.py`：素材查询/上传、独立项目创建/读取/删除、计划保存、版本恢复、渲染、字幕导出接口。
- `src/apps/editing/service.py`：素材归属校验、源快照/SHA-256 校验、乐观版本校验、项目工作区、输出登记。
- `AssemblyEditPlan`、`frontend/src/components/modules/assemblyEditing.ts`：基于源区间与时间线区间的裁剪、分割、重排、多音轨和字幕编辑。
- `EditingService.validate` 当前要求视频连续铺满目标时长且保持原速。不能据此宣称支持自由视频叠层、变速、网页动画或任意转场。
- `src/apps/agent_api.py:complete` 的普通对话调用传递 model/messages/stream，未在该路径提供剪辑工具调用闭环。现有 skill 提示词注入不等于可执行剪辑。

直接推论：现有时间线 API 足以作为基础 skill 剪辑的执行底座；仍需接通 Agent 工具、上下文投影、校验/反馈以及验收。尚未实现端到端自然语言剪辑。

## 后续方案（待实现）

1. 保留 `AssemblyEditPlan` 作为 Agent 与手动编辑的共同真相，不因参考 OpenFilm 引入第二套可编辑时间线。
2. 通过 owner-scoped 工具提供素材查询、读取项目及 revision、生成计划差异、保存新版本、预览检查、渲染及输出查询。身份来自服务端会话，不让模型指定 owner 或任意文件路径。
3. 给 Agent 的上下文包含稳定素材 ID、时长/流信息、源区间、轨道、最新 revision；签名预览 URL 仅按工具需要获取，不作为持久身份。
4. 修改前读取最新状态；保存携带 revision，冲突明确返回。复用源完整性和权限校验，不覆盖源素材。
5. 第一版 skill 聚焦原速裁剪、分割重排、字幕、对白/BGM/SFX。自动高光需要另行验证转录、词级时间和看片能力；不隐含在第一版承诺中。
6. 区分本次修改、保存版本与渲染结果，向用户展示可继续手动调整的时间线。

建议首个端到端用例：删除素材1的 1–2 秒，以 2–5 秒开场，插入素材2，再接素材1指定剩余区间，并添加字幕。需明确完整片段顺序及所舍弃区间，不能靠模型猜测“剩余”的含义。

## 后续验收

- 对话意图 → 结构化计划 → 保存新版本 → 手动编辑仍可继续 → MP4/SRT 输出可核查。
- 不覆盖源文件；片段源区间正确；音画时序、字幕与输出时长正确。
- 跨用户素材拒绝；过期版本拒绝；缺失/变更源拒绝；错误可追溯且不报告虚假成功。
- 预览/抽帧检查、取消/超时、重试幂等、费用提示等执行边界需单独设计和验证。

当前后续优先级：先优化现有剪辑交互；此文作为恢复 skill 开发的入口。
