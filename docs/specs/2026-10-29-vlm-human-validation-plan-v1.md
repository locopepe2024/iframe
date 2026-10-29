# 人物VLM辅助分析验证计划 v1

## Scope

仅Addams人物片段，原25fps、原帧号与SHA；只生成诊断结果，不改生产标签、相机、动作或IK。已授权使用现有UniArt/Qwen接口；每case只发一次，无自动重试，当前最多2次调用。沿用既有qwen3.8-flash路由，不将其视为已验证Qwen3-VL模型身份，记录实际返回模型名。

## Stages

1. overview：1–85帧稀疏概览，开头1–5连续补帧，覆盖前踢、落地、跑步及后续边界；提供原RGB、帧号与PTS，不给已知动作顺序、人工标签或白模。
2. dense：46–65连续帧，独立请求，不把overview结果写入提示；比较47/49/52/53/55/57/58/62/64的身体朝向、动作阶段、左右脚接触与抬跟。此轮只全身，不宣称测试足部ROI增益。
3. evaluator：模型返回冻结后才读取既有人工标签；只比较明确重叠帧。contact=left/right/both/airborne转换为左右二值；unknown单独报告。现有全掌/前掌真值缺失，不计算类型准确率。
4. 若格式/帧引用或语义未通过，记录失败边界；再决定足部ROI、不同采样或换模型，不无限追加调用。

## Success criteria

- 格式：JSON可解析、目标帧恰好覆盖、枚举与证据帧合法、事件边界引用提交帧。格式通过不等于语义正确。
- 支撑侧：同时报告全部明确标签帧的完全匹配率、回答覆盖率、已回答准确率；unknown不得从分母静默删除。不对小样本准确率作全片推广。
- 阶段：先对照用户动作顺序做人工语义复核；没有精确边界真值时不声称±1帧命中。镜头切换与姿态变化分开，区间边界允许不确定。
- 非生产晋升：任意关键左右混淆、支撑切换矛盾或伪造镜头变化即不得自动变成求解硬约束。
- 后续几何验收：只有阶段候选可靠且经复核，才做同相机/rig/帧的A/B；独立报告留出关节点投影、接触、根稳定和人工耗时。此轮不宣称已做迁移A/B。

## Commands

项目根运行`.venv/bin/python docs/agents/tools/addams_vlm_phase_test.py --case overview --run`及dense。输出目录固定且禁止覆盖；后续迭代使用新版本目录。保存prompt、提交图像SHA、model/usage/时延、原始文本、parsed与validation；不保存密钥或请求头。

## First execution / 2026-10-29

已生成overview 36张、dense 20张原RGB输入，执行两组盲测。沙箱首次各在约0.04秒内发生APIConnectionError；取得网络授权后保留失败记录重发，overview 66.71秒、dense 62.62秒仍为APIConnectionError，无响应文本、finish_reason或用量记录。不能据此判断服务端是否曾开始处理，不能认定没有计费。

无凭据连通性检查：配置主机uniart.fun首页HTTP 200，trust_env开/关均可；这仅证明首页可达，不证明带图推理路径可用，也不足以确定TLS、代理、上传或上游哪一层导致失败。模型语义验证尚未完成，准确率为空；暂停追加推理请求，下一步检查请求transport原因或复用既有流式调用路径，但需新版本实验和独立记录。

## Upstream/client discrepancy correction

用户确认UniArt显示成功。因此调用状态拆为upstream_status（用户报告成功）、client_response_status（未取得完整响应）、artifact_status（无模型结果文件），不能把本地APIConnectionError等同上游失败。已有两次非流式调用未记录底层cause、响应阶段和请求ID，无法回溯确定断在上传、响应头或响应体；也不能仅因约60秒耗时断言网关超时。

历史v4源分析曾通过同一路由流式调用成功：headers 41.66s，首块41.68s，完整87.64s，finish_reason=stop；但历史输入是单张拼图，本轮为36/20张图且非流式，二者不是受控对照，不能据此证明stream是唯一原因。

下一步先尝试通过可关联请求ID/时间范围及provider可用结果接口取回已有输出（接口存在与权限需另核对），不直接重发。后续新实验增加唯一client_request_id、UTC开始时间、底层异常类型链、响应头/首块/结束时间、逐块文本即时保存及usage；不输出token/敏感头。缺少结果取回接口时明确说明，不编造可恢复结果。

## Streaming reception slice / 2026-10-29

用户提供UniArt请求ID `202610290824565199590498268d9d6UH17ZeG0`、上游ID `202610290825394682872838268d9d6XuRKp8Bk`：总响应4m59s、输入18190/output8438 tokens、已计费；用户确认无法取回正文。无法将这条记录逐一对应到overview/dense，历史测试不重新提交。

新增独立诊断工具 `docs/agents/tools/addams_vlm_stream_probe.py`：仅源47/49/53三张既有RGB、1800最大输出tokens、不带人工标签、stream=true；每条SSE原文和文本增量flush/fsync，独立保留reasoning等原始事件，白名单保存响应ID。读取超时600秒是每次读取无活动等待上限，并非严格总时限；connect30/write120。无自动重试。严格要求DONE与finish_reason=stop才标完整；无用量或无正文不推测上游失败/未计费。异常记录类型链，不打印凭据。输出目录禁止覆盖。

本地四项离线验证：正常结束含usage/heartbeat、中断保留partial、缺DONE、length截断。通过后仅一次三图真实请求，任何失败均保留现状、不自动重发。成功也只证明小输入接收，不能证明完整多图稳定或语义准确；不改动作、相机、IK主链路。

三图真实请求结果：101.595秒完整收回、JSON/帧覆盖通过；支持脚全部unknown，覆盖0/3。返回completion_tokens=3825大于请求max_tokens=1800，后续应先验证路由限额契约，不扩大批量请求。完整结论见 `docs/agents/deliverables/2026-10-29-vlm-stream-reception.md`。
