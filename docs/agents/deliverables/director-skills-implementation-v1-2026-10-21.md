# 创作 Skills 实施切片 V1

依据：已确认 director-skills-usage-design 的第 11 节。2026-10-21。

本切片覆盖全剧理解、剧集理解、拍摄计划三个已有生成入口；四类是目录分组，具体任务由用户显式选择。分镜专项选择后续接入，不把视频优化器冒充叙事 Skill。

成功条件：目录按阶段过滤；错误阶段、重复或过期 revision 拒绝；空数组不注入；请求开始时冻结选择与方法正文；缓存指纹包含方法 revision；结果附只读执行来源；保存/采用走现有草稿流程。选择使用 owner+对象+stage 独立保存，不因保存选择改写草稿或伪造执行。

路径：config/agent_skills/director-tasks.json；src/apps/director_skills.py；comic_gen api/pipeline/llm/models；frontend 共享选择器和三个入口。

方法为本项目独立编写的简短适配，不复制采集卡片全文。来源指向已采集版本，仅作方法追溯；专业准确性与成片吸引力均须人工验证。审阅任务只输出问题/建议，不自动修订原文。无强制秒数、商业付费墙或默认美学。

本切片不创建第二套确认操作；不自动采用新建议；不修改模型/供应商权限；不宣称 hook 结构化 schema、自动跨镜头披露校验、组合预设或分镜专项已完成。既有采用计划的镜头字段承接本次规划；显式结构化 hook 数据下一切片实现。

验证：pytest tests/test_director_skills.py tests/test_director_profile.py tests/test_director_shooting_plan.py；前端选择器行为/请求测试、typecheck、build；上线前版本核对。

## 切片 B：镜头信息披露合同

在计划镜头增加可选 information_design 对象：观众问题、观众/人物已知信息、暂缓展示、呈现方式、依据 event IDs、揭示/兑现 event IDs、依据状态。采用状态沿用整份计划确认，不另设局部自动采用。事件 ID 必须属于本计划的已确认 story_map；ID 有效不证明语义依据成立。缺少依据允许标未核验，不伪造后续事件。

对象经计划保存/确认、EpisodeVisualShotContext、分镜上下文快照、模型边界有界投影和最终可读 Prompt 传递。只传所确认镜头的合同，不传上游方法全文；旧计划无该字段时不增加限制。用户可直接编辑合同，旧的 director_effect 保留。

验证范围增加：无效引用拒绝、未确认计划不进入上下文、确认后字段完整传递、投影与编译保留披露边界；不声称模型一定遵守或悬念效果提升。
