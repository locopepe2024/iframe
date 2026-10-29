# VLM辅助人物动作与镜头分析：公开方案与验证设计

## Observed

2026-10-29公开检索，使用GitHub公开README与arXiv摘要，不访问登录页。未将第三方宣传或基准结果当作本视频效果。

| 来源 | 已核对的内容 | 对本项目的用途与边界 |
|---|---|---|
| [Qwen3-VL官方仓库](https://github.com/QwenLM/Qwen3-VL) | 官方介绍包含视频时间定位、时间戳对齐、空间位置与遮挡理解；提供video_understanding cookbook | 通用视频分析候选。README的vLLM示例默认2fps采样不能用于证明25fps事件边界可靠；实际端点采样需记录 |
| [MotionLLM](https://arxiv.org/abs/2405.20340) | 摘要明确联合视频与SMPL动作序列，进行行为理解、描述及推理 | 与RGB+骨架联合质检直接相关；不是普通LLM提示词即可自动获得该专门模型能力 |
| [VideoChat-R1](https://github.com/OpenGVLab/VideoChat-R1)、[论文](https://arxiv.org/abs/2504.06958) | 仓库描述分层关注、逐步定位视频ROI；论文讨论temporal grounding和tracking | 采用全片粗定位→局部时间窗→足部ROI复核方式；不引用其基准增益作为我们的准确率 |
| [MotionGPT](https://arxiv.org/abs/2306.14795)、[代码](https://github.com/OpenMotionLab/MotionGPT) | motion tokens支持动作语言任务，包括生成、描述、预测和补间 | 说明动作语言建模可行，但不等于原视频逐帧重建、matchmoving或接触恢复 |

本地代码事实：`docs/agents/tools/addams_qwen_review.py`已有源46–59帧连续图像质检，询问动作候选、49帧阶段、身体朝向、左右腿、支撑侧/类型与不确定性；分离源视频分析和白模比较。该脚本存在不代表本轮已运行、或输出准确。它尚未形成完整镜头契约、严格schema验收和自动约束闭环。

## Direct implication

可以让视觉语言模型作为结构化语义观测层，输出镜头候选、动作阶段、可见性和脚接触候选，再由背景跟踪、姿态求解及人工关键事件验证。应使用VLM/MLLM而非只有文本输入的LLM。只问“描述动作”不够，需要证据帧和明确任务边界。

## Proposed structured output

- `source_sha256`、`source_fps`、`submitted_frames`、`shot_candidates`。
- 每个判断包含`evidence_frame_ids`、`observation`、`interpretation`、`alternatives`、`uncertainty`、`needs_review`；证据只能引用实际提交帧。
- 镜头：cut/dissolve/continuous/unknown；构图：half_body/full_body等；背景运动：stationary/moving/unknown；相机原因分别为translation/rotation/zoom/crop/unknown候选，不能由景别直接决定。
- 动作：转身/后扬腿/提腿/前踢/回收/落地/跑步等候选；时间边界用最后未发生帧与最早已发生帧的区间，不给未采样区间伪精确帧号。
- 左右脚分别输出：可见性、contact=contact/airborne/unknown、region=full_sole/forefoot/toe/heel/unknown、heel_raise、rolling_or_pivot；不以身体左右替代画面左右，无法辨认则unknown。
- `identity`保持跨帧；不把姿态检测器track id直接当人物身份。
- 禁止从单目图像输出假精确焦距、绝对深度、重力、世界坐标或骨骼四元数；不输出可直接生效的锁脚约束。

## Three-pass protocol

1. 全片原RGB加帧号/PTS做稀疏概览，独立提出镜头/动作事件候选。只此轮可用低采样率，不能直接定落脚边界。
2. 事件附近提供连续原25fps图像与全身上下文，再提供脚部ROI，确认动作先后与接触类型。脚小或模糊允许请求补帧/放大；不通过插帧创造证据。全画面和ROI须记录对应帧及裁剪坐标。
3. 在独立分析冻结后，才加入姿态叠图/白模候选、背景运动数值做差异检查。模型意见不自动覆盖人工标签；冲突进入少量关键事件复核。

系统提示词要求：只根据提供的时间序列分析；区分可见观察与推测，允许unknown；每个结论必须指出证据帧；不可将未见的中间过程补成确定事实；输出符合约定JSON。JSON可解析只证明格式，不证明视觉判断正确。

## Evaluation before integration

- A：现有RGB姿态/背景算法基准；B：加入RGB-VLM结构化语义；C：可选再加入估计深度，保持相同帧、模型版本和验收数据。先做B，不因论文存在就引入更多组件。
- 第一轮盲测不给用户已知动作顺序、接触标签或白模，避免模型复述答案。第二轮人机纠正另存，禁止和盲测混分。
- 事件以人工核准时间窗评估；若只有用户顺序但无帧边界，只评阶段顺序，不能声称帧准确。统计事件命中、边界帧误差、左右腿混淆、接触类型正确率、unknown覆盖及人工纠正量。
- 现有标签若未包含全掌/前掌等，只能验支撑侧；不能用未知标签算接触类型准确率。主观confidence不当校准概率。
- 辅助结果进入几何求解后，比较留出可见关节点、接触/穿地、根运动稳定、背景投影及人工耗时；识别文本更流畅不等于迁移变好。
- 自动接受阈值需实测校准。初期只生成候选，几何一致性/标签冲突进入复核，不直接生产锁脚。

## Not yet proven

未验证任何上述模型在本段卡通视频上的动作阶段、解剖左右与细粒度足底接触准确率；遮挡、宽衣和模糊可能导致幻觉。VLM能给语义候选不证明能唯一恢复三维或焦距。公开方案不是现成的“视频一键精准白模”。

## Next slice

复用既有Qwen入口做结构化协议升级，先建立原RGB盲测、事件放大复核及严格帧引用/schema检查；不用用户已知顺序作为盲测提示。通过后连接分镜/相机/动作接触契约，运行几何对照。此次只完成公开检索、代码检查与方案，不声称新增模型调用或标签已验收。
