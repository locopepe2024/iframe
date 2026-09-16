# 独立视频复刻功能 v1

日期：2026-09-17。状态：已启动规划，尚未实现。分支：feature/lumenx-recreation-v1。
依赖：PR #1 已合入 feature/lumenx-multi-user-v1，合并提交 44ee54d。

## Observed

- PR #1 提供 Studio H3/Seedance 模型保留、参考素材提交、provider ID 持久化与恢复、本地素材归属检查；198 项 mocked 测试复跑通过。
- 生产源码目录 /srv/lumenx/repo；Docker 容器 lumenx-backend，工作目录 /app；持久化挂载 /srv/lumenx/output → /app/output。
- 2026-09-17 核验生产仍是 eb9d44c，FFmpeg 和 FFprobe 均为 7.1.5。二进制存在不代表已有复刻分析 API 或 media 主机集成。
- 桌面“复刻”样本为15秒、变帧时间戳；已核实切点4.016667、9.083333、10.400000秒。联系表采样时间不能替代切点。
- 独立 GPT 5.6 Sol + H3 1.6.0 请求在提供明确时间线后保留四镜及静音；尚未验证H3接受和成片质量。

## 目标与边界

新增独立“复刻”入口及复刻项目记录，复用现有身份、资产存储、模型适配器及生成任务；不把自由Chat历史当作时间线事实来源，不复制一套provider提交逻辑。
第一版支持原片结构复刻与产品外观替换。精确切点是分析/装配约束；单次生成不能承诺帧级遵守原片。保留原声、静音和新声音设计作为明确不同选择。
暂不做自动ASR、口型替换、掩膜追踪或原片逐像素无损编辑。media主机接入方式未确认，不能假定Chat能直接远程执行FFmpeg。

## 分阶段交付

1. 原片注册与分析：用户拥有的原片登记，ffprobe读取真实PTS、time_base、时长、画幅和音轨；FFmpeg生成切点候选、相邻帧证据与联系表。产物写入用户作用域。分析为异步任务，记录状态/错误，限制执行时间与资源。禁止使用shell拼接用户参数。
2. 切点确认：独立时间线界面显示候选切点前后帧；允许增删调整，区分detected/manual/confirmed来源。支持导入精确时间线。确认前不把抽样时间升级为精确切点。
3. 替换规划与提示词：显式选择保留对象和替换素材；按实际执行附件生成Picture/Video映射。H3六字段输出必须通过切点、引用、声音约束检查；黄色产品与红色礼盒分开建模。校验器冒号定义兼容问题需先补行为测试解决。
4. 生成与恢复：确认参数后调用现有生成任务；任务绑定复刻项目/镜头/版本。保存provider ID，刷新/重启恢复；新增并发重复提交保护，不能把PR #1的已有ID恢复等同于完整幂等。
5. 装配与验收：按确认时间线裁切、拼接和处理音轨。生成片过短必须明确报错或要求选择处理策略，不能静默拉伸/补帧。镜头边界从真实时间基准计算；展示与目标切点的偏差，严格模式以选定输出帧网格验收。

## 数据契约草案

- RecreationProject：id、owner_user_id、owner_profile_id、source_asset_id、source_fingerprint、timeline_revision、audio_policy、status。
- SourceAnalysis：probe信息、分析器版本/参数、候选时间戳、证据帧资产、时间戳来源、状态/错误；与原片指纹绑定，原片变化需重新分析。
- Shot：id、start_pts/end_pts及time_base、展示秒数、cut_source、确认状态、证据引用、保留/替换约束。
- GenerationBinding：shot/project/revision、ordered_reference_asset_ids、编译标签映射、提示词版本、现有task ID、输出资产。
- Assembly：输入版本清单、目标帧率/时基、音轨策略、输出资产、实际时长与切点核验结果。

新增分析模块建议置于 src/apps/recreation/，前端独立模块置于 frontend/src/components/modules/recreation/；接入前先检查各目录局部规则和既有路由/后台任务约定。数据库迁移、API契约与UI入口在第一实现切片内定稿，不提前建立重复owner或存储系统。

## 验收与执行顺序

- 下一实现切片：原片归属注册 → 真实PTS探测 → 候选切点与证据帧输出，不调用付费生成。先用合成硬切片段验证，再用经授权的桌面样本验收。
- 必测：变帧时间戳、无音轨、损坏文件、FFmpeg超时、跨用户文件/任务访问、路径穿越与符号链接、任务重试、过期原片指纹。
- 样本集成验收：15秒、四段；三个已确认切点可导入并原样保留；0.5秒与1秒联系表去重，末帧14.983333不误作结束边界。
- mocked provider测试只证明请求/状态行为；H3在线生成及视觉质量另记运行观察，不宣布统计稳定性。
- 基础回归命令：python -m pytest tests/test_studio_h3_submission.py tests/test_video_task_recovery.py tests/test_reference_submission.py tests/test_agent_skills.py tests/test_h3_prompt_check.py -q。
- 新模块测试随实现添加；发布前核对本地、GitHub、主机、容器及前端manifest，完成健康检查。当前文档不宣称已部署或已实现。
